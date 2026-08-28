import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import { HttpMcpServer } from '../index.js';
import { TestTool } from '../helper/test-tools.js';
import { startHttpServer, createSession, listTools } from '../helper/http-client.js';

describe('HttpMcpServer hook events', () => {
    it('emits started once when the server starts (idempotent)', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        const started = vi.fn();
        server.hook().started().do(started);
        await server.start();
        await server.start();
        expect(started).toHaveBeenCalledTimes(1);
        await server.stop();
    });

    it('emits sessionCreated when a session is created', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        const created = vi.fn();
        server.hook().sessionCreated().do(created);
        const { port } = await startHttpServer(server);

        const sessionId = await createSession(port);
        expect(created).toHaveBeenCalledTimes(1);
        expect(created).toHaveBeenCalledWith(sessionId);

        await server.stop();
    });

    it('emits sessionDisposed on DELETE', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        const disposed = vi.fn();
        server.hook().sessionDisposed().do(disposed);
        const { port } = await startHttpServer(server);

        const sessionId = await createSession(port);
        expect(disposed).not.toHaveBeenCalled();

        const del = await new Promise<{ statusCode: number }>((resolve, reject) => {
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
                    res.resume();
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.end();
        });
        expect(del.statusCode).toBe(200);
        expect(disposed).toHaveBeenCalledTimes(1);
        expect(disposed).toHaveBeenCalledWith(sessionId);

        await server.stop();
    });

    it('does not emit sessionDisposed for a DELETE of an unknown session', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        const disposed = vi.fn();
        server.hook().sessionDisposed().do(disposed);
        const { port } = await startHttpServer(server);

        const del = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'DELETE',
                    headers: {
                        'Mcp-Session-Id': 'unknown',
                        'Mcp-Protocol-Version': '2025-03-26',
                        'Content-Length': '0'
                    }
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.end();
        });
        expect(del.statusCode).toBe(404);
        expect(disposed).not.toHaveBeenCalled();

        await server.stop();
    });

    it('emits sessionDisposed for every active session on stop', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        server.registerTool(new TestTool('t'));
        const disposed = vi.fn();
        server.hook().sessionDisposed().do(disposed);
        const { port } = await startHttpServer(server);

        const a = await createSession(port);
        const b = await createSession(port);
        expect(disposed).not.toHaveBeenCalled();

        await server.stop();

        expect(disposed).toHaveBeenCalledTimes(2);
        expect(disposed).toHaveBeenCalledWith(a);
        expect(disposed).toHaveBeenCalledWith(b);
    });

    it('hooks survive restart and fire again on the new server instance', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        const created = vi.fn();
        const disposed = vi.fn();
        server.hook().sessionCreated().do(created);
        server.hook().sessionDisposed().do(disposed);

        await server.start();
        const port = (
            server as unknown as { expressServer: { address(): { port: number } } }
        ).expressServer.address().port;
        await createSession(port);
        expect(created).toHaveBeenCalledTimes(1);
        await server.stop();
        expect(disposed).toHaveBeenCalledTimes(1);

        // Restart: hooks were registered on the same emitter, so they fire again.
        await server.start();
        const port2 = (
            server as unknown as { expressServer: { address(): { port: number } } }
        ).expressServer.address().port;
        await createSession(port2);
        expect(created).toHaveBeenCalledTimes(2);
        await server.stop();
        expect(disposed).toHaveBeenCalledTimes(2);
    });

    it('session events fire alongside tool registration on fresh sessions', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        const toolRegistered = vi.fn();
        const created = vi.fn();
        server.hook().toolRegistered().do(toolRegistered);
        server.hook().sessionCreated().do(created);
        server.registerTool(new TestTool('shared-tool'));
        const { port } = await startHttpServer(server);

        const sessionId = await createSession(port);
        const tools = await listTools(port, sessionId);
        expect(tools).toContain('shared-tool');
        expect(toolRegistered).toHaveBeenCalledWith('shared-tool');
        expect(created).toHaveBeenCalledTimes(1);

        await server.stop();
    });
});
