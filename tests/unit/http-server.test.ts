import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import { HttpMcpServer } from '../index.js';
import { INIT_BODY, startHttpServer } from '../helper/http-client.js';

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
        const { server, port } = await startHttpServer();

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
        const { server, port } = await startHttpServer();

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

        const { server, port } = await startHttpServer();

        const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(INIT_BODY)
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(INIT_BODY);
            req.end();
        });
        // Catch block swallows the error and returns 500
        expect(res.statusCode).toBe(500);

        mock.mockRestore();
        await server.stop();
    });

    it('returns 404 for DELETE without session ID', async () => {
        const { server, port } = await startHttpServer();

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

        const { server, port } = await startHttpServer();

        const promise = new Promise<{ statusCode: number }>((resolve) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(INIT_BODY)
                    }
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', () => resolve({ statusCode: 0 }));
                }
            );
            req.on('error', () => resolve({ statusCode: 0 }));
            req.write(INIT_BODY);
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
        const { server, port } = await startHttpServer();

        const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(INIT_BODY)
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
            req.write(INIT_BODY);
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
        const { port } = await startHttpServer(server);

        const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(INIT_BODY)
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
            req.write(INIT_BODY);
            req.end();
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('event:');

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
        const { port } = await startHttpServer(server);

        const agent = new http.Agent({ keepAlive: true });

        const first = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    agent,
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(INIT_BODY)
                    }
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(INIT_BODY);
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
                        'Content-Length': Buffer.byteLength(INIT_BODY)
                    }
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve({ ok: true }));
                    res.on('error', () => resolve({ ok: false }));
                }
            );
            req.on('error', () => resolve({ ok: false }));
            req.write(INIT_BODY);
            req.end();
        });
        expect(second.ok).toBe(false);

        agent.destroy();
    });
});
