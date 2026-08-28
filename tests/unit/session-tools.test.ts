import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import {
    Tool,
    ToolPackage,
    ToolParameters,
    ToolParameterProperty,
    PartialToolResult,
    ResultStatus
} from '@johannes.latzel/llm-chat';
import { HttpMcpServer } from '../index.js';
import type { SessionToolFactory, SessionToolSet } from '../index.js';
import type { McpServerObserver } from '../index.js';

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

/** Tool that reports which session-scoped instance handled the call. */
class SessionScopedTool extends Tool {
    constructor(private readonly instanceId: string) {
        super(
            'session_tool',
            'Reports the instance id of the tool that handled the call',
            new ToolParameters(
                {
                    input: ToolParameterProperty.string('Input value')
                },
                ['input']
            )
        );
    }

    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return { result: `instance ${this.instanceId}`, status: ResultStatus.Success };
    }
}

/** Factory producing fresh tool sets, recording dispose calls by instance id. */
function createFactory(disposeSpy: (id: string) => void, counter = { n: 0 }): SessionToolFactory {
    return {
        create(): SessionToolSet {
            const id = `id-${counter.n++}`;
            return {
                tools: [new SessionScopedTool(id)],
                async dispose() {
                    disposeSpy(id);
                }
            };
        }
    };
}

async function startServer(
    factory?: SessionToolFactory,
    observer?: McpServerObserver
): Promise<{ server: HttpMcpServer; port: number }> {
    const server = new HttpMcpServer(
        { name: 'test-http', version: '1.0.0', port: 0 },
        observer,
        factory
    );
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

async function deleteSession(port: number, sessionId: string): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        const req = http.request(
            `http://localhost:${port}/mcp`,
            {
                method: 'DELETE',
                headers: {
                    'Mcp-Session-Id': sessionId,
                    'Mcp-Protocol-Version': '2025-03-26',
                    'Content-Length': '0'
                }
            },
            (res) => {
                res.on('data', () => {});
                res.on('end', () => resolve(res.statusCode ?? 0));
                res.on('error', reject);
            }
        );
        req.on('error', reject);
        req.end();
    });
}

async function callTool(port: number, sessionId: string): Promise<string> {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'session_tool', arguments: { input: 'x' } }
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

async function listTools(port: number, sessionId: string): Promise<string> {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
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

describe('SessionToolFactory (HttpMcpServer)', () => {
    it('creates a fresh tool set per session with independent state', async () => {
        const dispose = vi.fn();
        const { server, port } = await startServer(createFactory(dispose));

        const sessionA = await createSession(port);
        const sessionB = await createSession(port);

        const resultA = await callTool(port, sessionA);
        const resultB = await callTool(port, sessionB);
        expect(resultA).toContain('instance id-0');
        expect(resultB).toContain('instance id-1');

        await server.stop();
    });

    it('disposes the tool set when a session is deleted', async () => {
        const dispose = vi.fn();
        const { server, port } = await startServer(createFactory(dispose));

        const sessionA = await createSession(port);
        const status = await deleteSession(port, sessionA);
        expect(status).toBe(200);
        expect(dispose).toHaveBeenCalledTimes(1);

        await server.stop();
    });

    it('disposes every tool set on stop', async () => {
        const dispose = vi.fn();
        const { server, port } = await startServer(createFactory(dispose));

        await createSession(port);
        await createSession(port);
        await server.stop();

        expect(dispose).toHaveBeenCalledTimes(2);
    });

    it('swallows dispose errors so session teardown still completes', async () => {
        const dispose = vi.fn(() => {
            throw new Error('dispose failed');
        });
        const { server, port } = await startServer(createFactory(dispose));

        const sessionA = await createSession(port);
        const status = await deleteSession(port, sessionA);
        expect(status).toBe(200);

        await server.stop();
    });

    it('registers shared tools alongside factory tools', async () => {
        class SharedTool extends Tool {
            constructor() {
                super(
                    'shared_tool',
                    'Shared inventory tool',
                    new ToolParameters({
                        input: ToolParameterProperty.string('Input value')
                    })
                );
            }

            protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                return { result: 'shared', status: ResultStatus.Success };
            }
        }

        const dispose = vi.fn();
        const server = new HttpMcpServer(
            { name: 'test-http', version: '1.0.0', port: 0 },
            undefined,
            createFactory(dispose)
        );
        server.registerTool(new SharedTool());
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const sessionId = await createSession(port);
        const body = await listTools(port, sessionId);
        expect(body).toContain('shared_tool');
        expect(body).toContain('session_tool');

        await server.stop();
    });

    it('flattens a ToolPackage inside the session tool set', async () => {
        class PackageTool extends Tool {
            constructor() {
                super(
                    'package_tool',
                    'Tool inside a package',
                    new ToolParameters({
                        input: ToolParameterProperty.string('Input value')
                    })
                );
            }

            protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                return { result: 'from package', status: ResultStatus.Success };
            }
        }

        const dispose = vi.fn();
        class PackageToolBundle extends ToolPackage {
            constructor() {
                super([new PackageTool()]);
            }
        }

        const factory: SessionToolFactory = {
            create(): SessionToolSet {
                return {
                    tools: [new PackageToolBundle()],
                    async dispose() {
                        dispose();
                    }
                };
            }
        };
        const { server, port } = await startServer(factory);

        const sessionId = await createSession(port);
        const body = await listTools(port, sessionId);
        expect(body).toContain('package_tool');

        await server.stop();
    });

    it('handles non-Error throws during dispose', async () => {
        const dispose = vi.fn(() => {
            throw 'string failure';
        });
        const { server, port } = await startServer(createFactory(dispose));

        const sessionA = await createSession(port);
        const status = await deleteSession(port, sessionA);
        expect(status).toBe(200);

        await server.stop();
    });

    it('reports factory tool calls to the observer', async () => {
        const dispose = vi.fn();
        const onToolCall = vi.fn();
        const observer: McpServerObserver = {
            onToolCall,
            onResourceRead: vi.fn()
        };
        const { server, port } = await startServer(createFactory(dispose), observer);

        const sessionId = await createSession(port);
        await callTool(port, sessionId);
        expect(onToolCall).toHaveBeenCalledTimes(1);
        expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ name: 'session_tool' }));

        await server.stop();
    });
});
