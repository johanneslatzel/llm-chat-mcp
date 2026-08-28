import type { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';

/** The JSON-RPC method modern clients probe with before the initialize handshake. */
export const DISCOVER_METHOD = 'server/discover';

/** A JSON-RPC envelope parsed from a session-less POST body. */
export type JsonRpcEnvelope = {
    method?: string;
    id?: number | string;
};

/** Result of inspecting a session-less POST before a transport is created. */
export type InspectedPost = {
    method: string | undefined;
    id: number | string | null;
    /** Replay the original wire request unchanged into a fresh body stream. */
    replay(): IncomingMessage;
};

/**
 * Buffer a session-less POST body, parse the JSON-RPC envelope, and provide a
 * byte-identical {@link InspectedPost.replay} for non-probe requests.
 */
export async function inspectSessionlessPost(req: IncomingMessage): Promise<InspectedPost> {
    const body = await readBody(req);
    const parsed = parseJsonRpc(body);
    return {
        method: parsed?.method,
        id: parsed?.id ?? null,
        replay: () => replayRequest(req, body)
    };
}

/**
 * Write HTTP 200 with a JSON-RPC `-32601` (Method not found) error body,
 * echoing the probe's request id (or `null` when absent).
 */
export function respondMethodNotFound(res: ServerResponse, id: number | string | null): void {
    const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32601, message: 'Method not found' }
    });
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}

/** Read the entire request body as UTF-8 text. */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

/**
 * Parse a JSON-RPC envelope. Returns `null` for invalid JSON, non-objects,
 * arrays, or payloads without a string `method`.
 */
function parseJsonRpc(raw: string): JsonRpcEnvelope | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.method !== 'string') {
        return null;
    }
    const envelope: JsonRpcEnvelope = { method: record.method };
    if (typeof record.id === 'number' || typeof record.id === 'string') {
        envelope.id = record.id;
    }
    return envelope;
}

/**
 * Rebuild the original request as a `PassThrough`-based `IncomingMessage`,
 * preserving the wire surface (headers, method, url, HTTP version, socket) and
 * re-sending the buffered body so the transport reads it unchanged.
 */
function replayRequest(original: IncomingMessage, body: string): IncomingMessage {
    const replay = new PassThrough();
    const message = replay as unknown as IncomingMessage;
    message.headers = original.headers;
    message.rawHeaders = original.rawHeaders;
    message.method = original.method;
    message.url = original.url;
    message.httpVersion = original.httpVersion;
    message.httpVersionMajor = original.httpVersionMajor;
    message.httpVersionMinor = original.httpVersionMinor;
    message.socket = original.socket;
    replay.end(body);
    return message;
}
