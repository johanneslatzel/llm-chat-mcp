import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { HttpMcpServer } from '../index.js';
import { TestTool } from '../helper/test-tools.js';
import { INIT_BODY, startHttpServer, createSession, listTools } from '../helper/http-client.js';

describe('HttpMcpServer sessions', () => {
    it('handles DELETE and re-initialization with tools intact', async () => {
        const server = new HttpMcpServer({
            name: 'test-http',
            version: '1.0.0',
            port: 0
        });
        server.registerTool(new TestTool('my-tool'));
        const { port } = await startHttpServer(server);

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
                            'Content-Length': Buffer.byteLength(INIT_BODY)
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
                req.write(INIT_BODY);
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
                            'Content-Length': Buffer.byteLength(INIT_BODY)
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
                req.write(INIT_BODY);
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
        const { port } = await startHttpServer(server);

        const sessionA = await createSession(port);
        const sessionB = await createSession(port);
        expect(sessionA).toBeDefined();
        expect(sessionB).toBeDefined();
        expect(sessionA).not.toBe(sessionB);

        const toolsA = await listTools(port, sessionA);
        const toolsB = await listTools(port, sessionB);
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
        const { port } = await startHttpServer(server);

        // Create session A before registering the new tool
        const sessionA = await createSession(port);
        const toolsA = await listTools(port, sessionA);
        expect(toolsA).toContain('original-tool');
        expect(toolsA).not.toContain('lazy-tool');

        // Register new tool after start
        server.registerTool(new TestTool('lazy-tool'));

        // Session A should NOT see the new tool (it was created before registration)
        const toolsAagain = await listTools(port, sessionA);
        expect(toolsAagain).toContain('original-tool');
        expect(toolsAagain).not.toContain('lazy-tool');

        // Session B (created after registration) SHOULD see the new tool
        const sessionB = await createSession(port);
        const toolsB = await listTools(port, sessionB);
        expect(toolsB).toContain('original-tool');
        expect(toolsB).toContain('lazy-tool');

        await server.stop();
    });
});
