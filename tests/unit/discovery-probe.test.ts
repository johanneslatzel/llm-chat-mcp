import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import {
    DISCOVER_METHOD,
    inspectSessionlessPost,
    respondMethodNotFound
} from '../../src/mcp/discovery-probe.js';
import { HttpMcpServer } from '../index.js';
import { TestTool } from '../helper/test-tools.js';
import type { SessionToolFactory, SessionToolSet } from '../index.js';
import { INIT_BODY, startHttpServer, listTools } from '../helper/http-client.js';

/** Build a fake IncomingMessage carrying the given body. */
function fakeRequest(body: string, overrides: Record<string, unknown> = {}): http.IncomingMessage {
    const stream = new PassThrough();
    const req = stream as unknown as http.IncomingMessage;
    req.method = 'POST';
    req.url = '/mcp';
    req.headers = { host: 'localhost', 'content-type': 'application/json' };
    req.rawHeaders = ['Host', 'localhost', 'Content-Type', 'application/json'];
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.socket = { encrypted: false } as unknown as http.IncomingMessage['socket'];
    Object.assign(req, overrides);
    stream.end(body);
    return req;
}

/** Build a fake ServerResponse that records status code and body. */
function fakeResponse(): { res: http.ServerResponse; status: () => number; body: () => string } {
    const result = { status: 0, body: '' };
    const res = {
        writeHead(status: number, _headers: Record<string, unknown>) {
            result.status = status;
            return res;
        },
        end(body: string) {
            result.body = body;
            return res;
        }
    } as unknown as http.ServerResponse;
    return { res, status: () => result.status, body: () => result.body };
}

describe('discovery-probe module', () => {
    it('parses a probe with a numeric id', async () => {
        const req = fakeRequest(JSON.stringify({ jsonrpc: '2.0', id: 7, method: DISCOVER_METHOD }));
        const inspected = await inspectSessionlessPost(req);
        expect(inspected.method).toBe(DISCOVER_METHOD);
        expect(inspected.id).toBe(7);
    });

    it('parses a probe with a string id', async () => {
        const req = fakeRequest(
            JSON.stringify({ jsonrpc: '2.0', id: 'abc', method: DISCOVER_METHOD })
        );
        const inspected = await inspectSessionlessPost(req);
        expect(inspected.id).toBe('abc');
    });

    it('returns null id when absent', async () => {
        const req = fakeRequest(JSON.stringify({ jsonrpc: '2.0', method: DISCOVER_METHOD }));
        const inspected = await inspectSessionlessPost(req);
        expect(inspected.id).toBeNull();
    });

    it('surfaces method undefined for malformed JSON', async () => {
        const req = fakeRequest('{not json');
        const inspected = await inspectSessionlessPost(req);
        expect(inspected.method).toBeUndefined();
        expect(inspected.id).toBeNull();
    });

    it('surfaces method undefined for non-object payloads', async () => {
        const req = fakeRequest('[1,2,3]');
        const inspected = await inspectSessionlessPost(req);
        expect(inspected.method).toBeUndefined();
    });

    it('surfaces method undefined when method is not a string', async () => {
        const req = fakeRequest(JSON.stringify({ jsonrpc: '2.0', method: 42 }));
        const inspected = await inspectSessionlessPost(req);
        expect(inspected.method).toBeUndefined();
    });

    it('replays the identical body for non-probe POSTs', async () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' });
        const req = fakeRequest(body);
        const inspected = await inspectSessionlessPost(req);
        expect(inspected.method).toBe('initialize');

        const replay = inspected.replay();
        const replayed = await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            replay.on('data', (chunk: Buffer) => chunks.push(chunk));
            replay.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        expect(replayed).toBe(body);
        expect(replay.method).toBe('POST');
        expect(replay.url).toBe('/mcp');
        expect(replay.headers).toEqual({ host: 'localhost', 'content-type': 'application/json' });
        expect(replay.httpVersion).toBe('1.1');
    });

    it('respondMethodNotFound writes 200 with -32601 and echoes the id', () => {
        const { res, status, body } = fakeResponse();
        respondMethodNotFound(res, 7);
        expect(status()).toBe(200);
        const parsed = JSON.parse(body());
        expect(parsed.error.code).toBe(-32601);
        expect(parsed.id).toBe(7);
    });

    it('respondMethodNotFound echoes null id', () => {
        const { res, status, body } = fakeResponse();
        respondMethodNotFound(res, null);
        expect(status()).toBe(200);
        expect(JSON.parse(body()).id).toBeNull();
    });
});

describe('HttpMcpServer server/discover probe fallback', () => {
    it('answers a session-less server/discover probe with -32601 without creating a session', async () => {
        const factory: SessionToolFactory = {
            create(): SessionToolSet {
                return { tools: [new TestTool('session')], async dispose() {} };
            }
        };
        const createSpy = vi.spyOn(factory, 'create');
        const server = new HttpMcpServer(
            { name: 'test-http', version: '1.0.0', port: 0 },
            undefined,
            factory
        );
        const { port } = await startHttpServer(server);

        const probeBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'server/discover',
            params: {}
        });
        const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(probeBody)
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
            req.write(probeBody);
            req.end();
        });

        expect(res.statusCode).toBe(200);
        const parsed = JSON.parse(res.body);
        expect(parsed.error.code).toBe(-32601);
        expect(parsed.id).toBe(1);
        expect(createSpy).not.toHaveBeenCalled();

        await server.stop();
    });

    it('probe then initialize on the same server still works (replay integrity)', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        server.registerTool(new TestTool('my-tool'));
        const { port } = await startHttpServer(server);

        const probeBody = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'server/discover',
            params: {}
        });
        await new Promise<void>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(probeBody)
                    }
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve());
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(probeBody);
            req.end();
        });

        const sessionId = await new Promise<string>((resolve, reject) => {
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
                    const sid = res.headers['mcp-session-id'] as string;
                    res.resume();
                    res.on('end', () => resolve(sid));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(INIT_BODY);
            req.end();
        });
        expect(sessionId).toBeDefined();

        const tools = await listTools(port, sessionId);
        expect(tools).toContain('my-tool');

        await server.stop();
    });

    it('malformed-JSON session-less POST behaves exactly as before (transport parse error)', async () => {
        const { server, port } = await startHttpServer();
        const badBody = '{not json';
        const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
            const req = http.request(
                `http://localhost:${port}/mcp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(badBody)
                    }
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(badBody);
            req.end();
        });
        expect(res.statusCode).toBe(400);
        await server.stop();
    });

    it('initialize still creates exactly one session', async () => {
        const server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
        server.registerTool(new TestTool('my-tool'));
        const { port } = await startHttpServer(server);

        const sessionId = await new Promise<string>((resolve, reject) => {
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
                    const sid = res.headers['mcp-session-id'] as string;
                    res.resume();
                    res.on('end', () => resolve(sid));
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(INIT_BODY);
            req.end();
        });
        expect(sessionId).toBeDefined();
        const tools = await listTools(port, sessionId);
        expect(tools).toContain('my-tool');
        await server.stop();
    });
});
