import type { JSONRPCMessage, JSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@johannes.latzel/llm-chat';

/** Structural view of a JSON-RPC request that carries tool-call arguments. */
interface ToolCallRequestMessage extends JSONRPCRequest {
    method: 'tools/call';
    params: {
        name?: unknown;
        arguments?: unknown;
    };
}

/**
 * Returns true for a JSON-RPC request whose method is `tools/call`.
 *
 * The check is structural because the SDK's `JSONRPCMessage` union is the
 * base request/notification/response union, not the method-specific one.
 */
function isToolCallRequest(message: JSONRPCMessage): message is ToolCallRequestMessage {
    if (!('method' in message) || message.method !== 'tools/call') {
        return false;
    }
    if (!('id' in message) || !('params' in message)) {
        return false;
    }
    return true;
}

/**
 * Rewrites hidden parameter aliases in a `tools/call` request to their
 * canonical names before the MCP SDK validates the arguments.
 *
 * Other messages, calls to unknown tools, and malformed argument values are
 * left untouched so the SDK can report its normal validation errors.
 *
 * @param message - Incoming JSON-RPC message.
 * @param tools   - Tool instances available on the server, keyed by tool name.
 */
export function normalizeToolCallArguments(
    message: JSONRPCMessage,
    tools: ReadonlyMap<string, Tool>
): void {
    if (!isToolCallRequest(message)) {
        return;
    }

    const { name, arguments: args } = message.params;
    if (typeof name !== 'string' || args === undefined || args === null) {
        return;
    }
    if (typeof args !== 'object' || Array.isArray(args)) {
        return;
    }

    const tool = tools.get(name);
    if (!tool) {
        return;
    }

    // Safe: the guard above proves a non-array object, which is the shape Tool expects.
    message.params.arguments = tool.normalizeArguments(args as Record<string, unknown>);
}
