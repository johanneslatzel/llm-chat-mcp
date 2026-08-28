import http from 'node:http';
import { HttpMcpServer } from '../index.js';

/** Standard MCP initialize request body. */
export const INIT_BODY = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' }
    }
});

/** Start an HTTP MCP server on an ephemeral port and return it with the port. */
export async function startHttpServer(
    server?: HttpMcpServer
): Promise<{ server: HttpMcpServer; port: number }> {
    if (!server) {
        server = new HttpMcpServer({ name: 'test-http', version: '1.0.0', port: 0 });
    }
    await server.start();
    const address = (
        server as unknown as { expressServer: { address(): { port: number } } }
    ).expressServer.address();
    return { server, port: address.port };
}

/** Initialize a new MCP session and return its session ID. */
export async function createSession(port: number): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
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
                const sessionId = res.headers['mcp-session-id'] as string;
                res.on('data', () => {});
                res.on('end', () => resolve(sessionId));
                res.on('error', reject);
            }
        );
        req.on('error', reject);
        req.write(INIT_BODY);
        req.end();
    });
}

/** Send a JSON-RPC request to an existing session and return the response body. */
export async function sendRequest(port: number, sessionId: string, body: string): Promise<string> {
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

/** Call `tools/list` on a session and return the raw response body. */
export async function listTools(port: number, sessionId: string): Promise<string> {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    });
    return sendRequest(port, sessionId, body);
}

/** Call a tool by name on a session and return the raw response body. */
export async function callTool(
    port: number,
    sessionId: string,
    name: string,
    args: Record<string, unknown> = { input: 'x' }
): Promise<string> {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name, arguments: args }
    });
    return sendRequest(port, sessionId, body);
}
