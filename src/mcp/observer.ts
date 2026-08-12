/** Data reported when an agent tool call finishes. */
export type ToolCallInfo = {
    /** Name of the tool that was called. */
    name: string;
    /** Arguments passed to the tool call. */
    args: Record<string, unknown>;
    /** Result payload produced by the tool (set on success). */
    result?: unknown;
    /** Error message (set when the tool call threw). */
    error?: string;
    /** Duration of the tool call in milliseconds. */
    durationMs: number;
};

/** Data reported when an MCP resource is read. */
export type ResourceReadInfo = {
    /** URI of the resource that was read. */
    uri: string;
    /** Whether the read succeeded. */
    ok: boolean;
    /** Duration of the read in milliseconds. */
    durationMs: number;
};

/** Observer notified about agent tool calls and resource reads. */
export interface McpServerObserver {
    /** Called after a tool call finishes (success or error). */
    onToolCall(info: ToolCallInfo): void;
    /** Called after a resource read finishes (success or error). */
    onResourceRead(info: ResourceReadInfo): void;
}
