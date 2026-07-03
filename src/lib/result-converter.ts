import { ResultStatus, ToolResult } from '@johannes.latzel/llm-chat';

/** A single text content item in an MCP `CallToolResult`. */
type ToolResultEnty = {
    type: 'text';
    text: string;
};

/** The top-level result shape expected by the MCP `CallToolResult` response. */
type McpToolResult = {
    content: ToolResultEnty[];
    isError?: boolean;
};

/**
 * Convert an array of llm-chat `ToolResult` objects into an MCP
 * `CallToolResult`-compatible shape. Sets `isError` when **any** result
 * carries a non-success status.
 */
export function toolResultsToMcp(results: ToolResult[]): McpToolResult {
    const isError = results.some((result) => result.status === ResultStatus.Error);
    return {
        content: results.map((result) => ({
            type: 'text' as const,
            text: result.result
        })),
        ...(isError ? { isError: true } : {})
    };
}
