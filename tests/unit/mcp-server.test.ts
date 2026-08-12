import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    Tool,
    ToolPackage,
    ToolParameters,
    ToolParameterProperty,
    PartialToolResult,
    ResultStatus
} from '@johannes.latzel/llm-chat';
import { StdioMcpServer, HttpMcpServer } from '../index.js';

class TestTool extends Tool {
    constructor(name: string) {
        super(
            name,
            `Tool ${name}`,
            new ToolParameters(
                {
                    input: ToolParameterProperty.string('Input value')
                },
                ['input']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `executed ${this.name} with ${String(args.input)}`,
            status: ResultStatus.Success
        };
    }
}

class TestToolError extends Tool {
    constructor(name: string) {
        super(
            name,
            `Tool ${name}`,
            new ToolParameters(
                {
                    input: ToolParameterProperty.string('Input value')
                },
                ['input']
            )
        );
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `error from ${this.name}`,
            status: ResultStatus.Error
        };
    }
}

class TestPackage extends ToolPackage {
    constructor() {
        super([new TestTool('pkg-tool-a'), new TestTool('pkg-tool-b')]);
    }
}

describe('McpToolServer', () => {
    it('creates a server with valid info', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        expect(server).toBeInstanceOf(StdioMcpServer);
    });

    it('registers a single Tool', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        expect(() => server.registerTool(new TestTool('my-tool'))).not.toThrow();
    });

    it('registers a ToolPackage', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        expect(() => server.registerTool(new TestPackage())).not.toThrow();
    });

    it('throws when registering duplicate tool name', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        const tool = new TestTool('dup');
        server.registerTool(tool);
        expect(() => server.registerTool(tool)).toThrow();
    });

    it('executes a registered tool handler', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        const tool = new TestTool('echo');
        server.registerTool(tool);
        const registeredTools = (server as any).mcpServer._registeredTools as Record<
            string,
            { handler: Function }
        >;
        const registered = registeredTools['echo']!;
        const result = await registered.handler({ input: 'hello' }, {});
        expect(result.content[0]?.text).toBe('executed echo with hello');
    });

    it('starts and stops without error', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        await expect(server.start()).resolves.toBeUndefined();
        await expect(server.stop()).resolves.toBeUndefined();
    });

    it('restarts after stop', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        await server.start();
        await server.stop();
        await expect(server.start()).resolves.toBeUndefined();
        await server.stop();
    });

    it('returns error content when tool returns Error status', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        const tool = new TestToolError('failing');
        server.registerTool(tool);
        const registeredTools = (server as any).mcpServer._registeredTools as Record<
            string,
            { handler: Function }
        >;
        const registered = registeredTools['failing']!;
        const result = await registered.handler({ input: 'hello' }, {});
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toBe('error from failing');
    });

    it('threads a server observer to tool calls and resource reads', async () => {
        const onToolCall = vi.fn();
        const onResourceRead = vi.fn();
        const server = new StdioMcpServer(
            { name: 'test-server', version: '1.0.0' },
            { onToolCall, onResourceRead }
        );
        server.registerTool(new TestTool('echo'));
        const notes = path.resolve('tests/helper/docs/notes.md');
        server.registerDocument(notes);

        const registeredTools = (server as any).mcpServer._registeredTools as Record<
            string,
            { handler: Function }
        >;
        const toolResult = await registeredTools['echo']!.handler({ input: 'hello' }, {});
        expect(toolResult.content[0]?.text).toBe('executed echo with hello');
        expect(onToolCall).toHaveBeenCalledTimes(1);

        const registeredResources = (server as any).mcpServer
            ._registeredResources as Record<
            string,
            { readCallback: (uri: URL) => Promise<unknown> }
        >;
        const uri = pathToFileURL(notes).toString();
        await registeredResources[uri]!.readCallback(new URL(uri));
        expect(onResourceRead).toHaveBeenCalledTimes(1);
    });
});

describe('HttpMcpServer', () => {
    it('creates an HTTP server with valid info', () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        expect(server).toBeInstanceOf(HttpMcpServer);
    });

    it('returns 404 for unknown session and 400 for GET without session', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        // GET without session ID should return 400
        const getRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(`http://localhost:${port}/mcp`, { method: 'GET' }, (res) => {
                res.on('data', () => {});
                res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        });
        expect(getRes.statusCode).toBe(400);

        // POST with unknown session ID should return 404
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'ping',
            params: {}
        });
        const postRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Mcp-Session-Id': 'nonexistent',
                        'Mcp-Protocol-Version': '2025-03-26',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        expect(postRes.statusCode).toBe(404);

        // DELETE with unknown session ID should return 404
        const delRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'DELETE',
                    headers: {
                        'Mcp-Session-Id': 'nonexistent',
                        'Content-Length': '0'
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.end();
        });
        expect(delRes.statusCode).toBe(404);

        await server.stop();
    });

    it('returns 400 for non-initialize POST without session', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {}
        });
        const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        // Transport rejects non-initialize without session as "Server not initialized"
        expect(res.statusCode).toBe(400);

        await server.stop();
    });

    it('returns 500 when transport handler throws', async () => {
        const { StreamableHTTPServerTransport } =
            await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
        const mock = vi.spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest');
        mock.mockRejectedValueOnce(new Error('test error'));

        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });
        const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        // Catch block swallows the error and returns 500
        expect(res.statusCode).toBe(500);

        mock.mockRestore();
        await server.stop();
    });

    it('returns 404 for DELETE without session ID', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                { method: 'DELETE' },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.end();
        });
        expect(res.statusCode).toBe(404);

        await server.stop();
    });

    it('destroys connection when handler throws after headers sent', async () => {
        const { StreamableHTTPServerTransport } =
            await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
        const mock = vi.spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest');
        mock.mockImplementationOnce(async (_req: any, res: any) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            throw new Error('error after headers');
        });

        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        const promise = new Promise<{ statusCode: number }>((resolve) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', () => resolve({ statusCode: 0 }));
                }
            );
            req.on('error', () => resolve({ statusCode: 0 }));
            req.write(body);
            req.end();
        });

        const res = await promise;
        // Connection destroyed, status 0 means error/abort
        expect(res.statusCode).toBe(0);

        mock.mockRestore();
        await server.stop();
    });

    it('start is idempotent', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        await server.start();
        await server.stop();
    });

    it('handles MCP initialize request', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();

        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('event:');

        await server.stop();
    });

    it('restarts after stop', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        await server.stop();
        await expect(server.start()).resolves.toBeUndefined();
        await server.stop();
    });

    it('handles MCP initialize after restart', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        await server.stop();

        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('event:');

        await server.stop();
    });

    it('handles DELETE and re-initialization with tools intact', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        server.registerTool(new TestTool('my-tool'));
        await server.start();

        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const initBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        // First initialize
        const res1 = await new Promise<{ statusCode: number; sessionId?: string }>(
            (resolve, reject) => {
                const req = http.request(
                    `http://localhost:${port}/mcp`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json, text/event-stream',
                            'Content-Length': Buffer.byteLength(initBody)
                        }
                    },
                    (res) => {
                        const sessionId = res.headers['mcp-session-id'] as string | undefined;
                        res.on('data', () => {});
                        res.on('end', () => {
                            resolve({
                                statusCode: res.statusCode ?? 0,
                                ...(sessionId !== undefined ? { sessionId } : {})
                            });
                        });
                        res.on('error', reject);
                    }
                );
                req.on('error', reject);
                req.write(initBody);
                req.end();
            }
        );
        expect(res1.statusCode).toBe(200);
        expect(res1.sessionId).toBeDefined();

        // DELETE to disconnect
        const del = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'DELETE',
                    headers: {
                        'Mcp-Session-Id': res1.sessionId!,
                        'Mcp-Protocol-Version': '2025-03-26',
                        'Content-Length': '0'
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.end();
        });
        expect(del.statusCode).toBe(200);

        // Second initialize (must succeed after DELETE)
        const res2 = await new Promise<{ statusCode: number; sessionId?: string }>(
            (resolve, reject) => {
                const req = http.request(
                    `http://localhost:${port}/mcp`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json, text/event-stream',
                            'Content-Length': Buffer.byteLength(initBody)
                        }
                    },
                    (res) => {
                        const sessionId = res.headers['mcp-session-id'] as string | undefined;
                        res.on('data', () => {});
                        res.on('end', () => {
                            resolve({
                                statusCode: res.statusCode ?? 0,
                                ...(sessionId !== undefined ? { sessionId } : {})
                            });
                        });
                        res.on('error', reject);
                    }
                );
                req.on('error', reject);
                req.write(initBody);
                req.end();
            }
        );
        expect(res2.statusCode).toBe(200);
        expect(res2.sessionId).toBeDefined();

        // tools/list should work (tool registration survives transport swap)
        const listBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
        });
        const res3 = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Mcp-Session-Id': res2.sessionId!,
                        'Mcp-Protocol-Version': '2025-03-26',
                        'Content-Length': Buffer.byteLength(listBody)
                    }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(listBody);
            req.end();
        });
        expect(res3.statusCode).toBe(200);
        expect(res3.body).toContain('my-tool');

        await server.stop();
    });

    it('handles multiple concurrent sessions with independent tool state', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        server.registerTool(new TestTool('shared-tool'));
        await server.start();

        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const initBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        async function createSession(): Promise<string> {
            const res = await new Promise<{ sessionId: string }>((resolve, reject) => {
                const req = http.request(
                    `http://localhost:${port}/mcp`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json, text/event-stream',
                            'Content-Length': Buffer.byteLength(initBody)
                        }
                    },
                    (res) => {
                        const sessionId = res.headers['mcp-session-id'] as string;
                        res.on('data', () => {});
                        res.on('end', () => resolve({ sessionId }));
                        res.on('error', reject);
                    }
                );
                req.on('error', reject);
                req.write(initBody);
                req.end();
            });
            return res.sessionId;
        }

        const sessionA = await createSession();
        const sessionB = await createSession();
        expect(sessionA).toBeDefined();
        expect(sessionB).toBeDefined();
        expect(sessionA).not.toBe(sessionB);

        async function listTools(sessionId: string): Promise<string> {
            const listBody = JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
            });
            const res = await new Promise<{ statusCode: number; body: string }>(
                (resolve, reject) => {
                    const req = http.request(
                        `http://localhost:${port}/mcp`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Accept: 'application/json, text/event-stream',
                                'Mcp-Session-Id': sessionId,
                                'Mcp-Protocol-Version': '2025-03-26',
                                'Content-Length': Buffer.byteLength(listBody)
                            }
                        },
                        (res) => {
                            let data = '';
                            res.on('data', (chunk: string) => {
                                data += chunk;
                            });
                            res.on('end', () =>
                                resolve({ statusCode: res.statusCode ?? 0, body: data })
                            );
                            res.on('error', reject);
                        }
                    );
                    req.on('error', reject);
                    req.write(listBody);
                    req.end();
                }
            );
            expect(res.statusCode).toBe(200);
            return res.body;
        }

        const toolsA = await listTools(sessionA);
        const toolsB = await listTools(sessionB);
        expect(toolsA).toContain('shared-tool');
        expect(toolsB).toContain('shared-tool');

        await server.stop();
    });

    it('isolates tools registered after start to new sessions only', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        server.registerTool(new TestTool('original-tool'));
        await server.start();

        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const initBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        async function createSession(): Promise<string> {
            const res = await new Promise<{ sessionId: string }>((resolve, reject) => {
                const req = http.request(
                    `http://localhost:${port}/mcp`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json, text/event-stream',
                            'Content-Length': Buffer.byteLength(initBody)
                        }
                    },
                    (res) => {
                        const sessionId = res.headers['mcp-session-id'] as string;
                        res.on('data', () => {});
                        res.on('end', () => resolve({ sessionId }));
                        res.on('error', reject);
                    }
                );
                req.on('error', reject);
                req.write(initBody);
                req.end();
            });
            return res.sessionId;
        }

        async function listTools(sessionId: string): Promise<string> {
            const listBody = JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
            });
            const res = await new Promise<{ statusCode: number; body: string }>(
                (resolve, reject) => {
                    const req = http.request(
                        `http://localhost:${port}/mcp`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Accept: 'application/json, text/event-stream',
                                'Mcp-Session-Id': sessionId,
                                'Mcp-Protocol-Version': '2025-03-26',
                                'Content-Length': Buffer.byteLength(listBody)
                            }
                        },
                        (res) => {
                            let data = '';
                            res.on('data', (chunk: string) => {
                                data += chunk;
                            });
                            res.on('end', () =>
                                resolve({ statusCode: res.statusCode ?? 0, body: data })
                            );
                            res.on('error', reject);
                        }
                    );
                    req.on('error', reject);
                    req.write(listBody);
                    req.end();
                }
            );
            expect(res.statusCode).toBe(200);
            return res.body;
        }

        // Create session A before registering the new tool
        const sessionA = await createSession();
        const toolsA = await listTools(sessionA);
        expect(toolsA).toContain('original-tool');
        expect(toolsA).not.toContain('lazy-tool');

        // Register new tool after start
        server.registerTool(new TestTool('lazy-tool'));

        // Session A should NOT see the new tool (it was created before registration)
        const toolsAagain = await listTools(sessionA);
        expect(toolsAagain).toContain('original-tool');
        expect(toolsAagain).not.toContain('lazy-tool');

        // Session B (created after registration) SHOULD see the new tool
        const sessionB = await createSession();
        const toolsB = await listTools(sessionB);
        expect(toolsB).toContain('original-tool');
        expect(toolsB).toContain('lazy-tool');

        await server.stop();
    });

    it('stop without start does not throw', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await expect(server.stop()).resolves.toBeUndefined();
    });

    it('double stop is idempotent', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        await server.stop();
        await expect(server.stop()).resolves.toBeUndefined();
    });

    it('destroys keep-alive connections on stop', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const agent = new http.Agent({ keepAlive: true });

        const initBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        const first = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    agent,
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(initBody)
                    }
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(initBody);
            req.end();
        });
        expect(first.statusCode).toBe(200);

        await new Promise((r) => setTimeout(r, 50));

        await server.stop();

        const second = await new Promise<{ ok: boolean }>((resolve) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    agent,
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(initBody)
                    }
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve({ ok: true }));
                    res.on('error', () => resolve({ ok: false }));
                }
            );
            req.on('error', () => resolve({ ok: false }));
            req.write(initBody);
            req.end();
        });
        expect(second.ok).toBe(false);

        agent.destroy();
    });
});


describe('tool state (StdioMcpServer)', () => {
    it('keeps all tools enabled by default', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(true);
    });

    it('disables the named tools', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.setDisabledTools(['b']);
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(false);
    });

    it('disables all tools when every name is listed', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.setDisabledTools(['a', 'b']);
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(false);
        expect(tools['b']!.enabled).toBe(false);
    });

    it('re-enables previously disabled tools for an empty list', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.setDisabledTools(['b']);
        server.setDisabledTools([]);
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(true);
    });

    it('ignores unknown tool names without throwing', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        expect(() => server.setDisabledTools(['unknown'])).not.toThrow();
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
    });

    it('disables a single tool live', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.disableTool('b');
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(false);
    });

    it('enables a single tool live', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.disableTool('a');
        server.enableTool('a');
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
    });

    it('ignores unknown names for single-tool toggles', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        expect(() => server.disableTool('unknown')).not.toThrow();
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
    });
});

describe('tool state (HttpMcpServer)', () => {
    const initBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' }
        }
    });

    async function startServer(): Promise<{ server: HttpMcpServer; port: number }> {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        server.registerTool(new TestTool('shared-tool'));
        server.registerTool(new TestTool('other-tool'));
        await server.start();
        const address = (server as any).expressServer.address();
        return { server, port: address.port };
    }

    async function createSession(port: number): Promise<string> {
        return await new Promise<string>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(initBody)
                    }
                },
                (res) => {
                    const sessionId = res.headers['mcp-session-id'] as string;
                    res.on('data', () => {});
                    res.on('end', () => resolve(sessionId));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(initBody);
            req.end();
        });
    }

    async function listTools(port: number, sessionId: string): Promise<string> {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
        });
        return await new Promise<string>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Mcp-Session-Id': sessionId,
                        'Mcp-Protocol-Version': '2025-03-26',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });
                    res.on('end', () => resolve(data));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    async function callTool(port: number, sessionId: string, name: string): Promise<string> {
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name, arguments: { input: 'x' } }
        });
        return await new Promise<string>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Mcp-Session-Id': sessionId,
                        'Mcp-Protocol-Version': '2025-03-26',
                        'Content-Length': Buffer.byteLength(body)
                    }
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });
                    res.on('end', () => resolve(data));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    it('updates existing sessions live', async () => {
        const { server, port } = await startServer();
        const sessionId = await createSession(port);

        let body = await listTools(port, sessionId);
        expect(body).toContain('shared-tool');
        expect(body).toContain('other-tool');

        server.setDisabledTools(['shared-tool']);
        body = await listTools(port, sessionId);
        expect(body).not.toContain('shared-tool');
        expect(body).toContain('other-tool');

        server.setDisabledTools([]);
        body = await listTools(port, sessionId);
        expect(body).toContain('shared-tool');
        expect(body).toContain('other-tool');

        await server.stop();
    });

    it('applies to sessions created after the call', async () => {
        const { server, port } = await startServer();
        server.setDisabledTools(['shared-tool']);

        const sessionId = await createSession(port);
        const body = await listTools(port, sessionId);
        expect(body).not.toContain('shared-tool');
        expect(body).toContain('other-tool');

        await server.stop();
    });

    it('updates all concurrent sessions', async () => {
        const { server, port } = await startServer();
        const sessionA = await createSession(port);
        const sessionB = await createSession(port);

        server.setDisabledTools(['shared-tool']);
        const bodyA = await listTools(port, sessionA);
        const bodyB = await listTools(port, sessionB);
        expect(bodyA).not.toContain('shared-tool');
        expect(bodyB).not.toContain('shared-tool');

        await server.stop();
    });

    it('rejects calls to disabled tools in existing sessions', async () => {
        const { server, port } = await startServer();
        const sessionId = await createSession(port);
        server.setDisabledTools(['shared-tool']);

        const body = await callTool(port, sessionId, 'shared-tool');
        expect(body).toContain('disabled');

        await server.stop();
    });

    it('applies single-tool toggles to existing sessions live', async () => {
        const { server, port } = await startServer();
        const sessionId = await createSession(port);

        server.disableTool('shared-tool');
        let body = await listTools(port, sessionId);
        expect(body).not.toContain('shared-tool');
        expect(body).toContain('other-tool');

        server.enableTool('shared-tool');
        body = await listTools(port, sessionId);
        expect(body).toContain('shared-tool');
        expect(body).toContain('other-tool');

        await server.stop();
    });
});
