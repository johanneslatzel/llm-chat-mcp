import type { Tool, ToolPackage } from '@johannes.latzel/llm-chat';

/**
 * The tool inventory created for a single MCP session together with a
 * cleanup hook that releases any session-scoped resources the tools captured.
 *
 * When an HTTP session ends (DELETE or server stop) the {@link dispose} hook
 * is awaited so per-session state such as a dedicated workspace instance is
 * torn down and cannot leak into later sessions.
 */
export interface SessionToolSet {
    /** Tool instances (or tool packages) registered for the session. */
    tools: (Tool | ToolPackage)[];
    /**
     * Release any resources captured by the tools of this session.
     * Called exactly once when the session is torn down; must not throw.
     */
    dispose(): Promise<void>;
}

/**
 * Produces a fresh {@link SessionToolSet} for each new HTTP session.
 *
 * Because tool instances may capture mutable state (e.g. a workspace root),
 * every session gets its own set so concurrently connected clients never
 * share or race on that state. When no factory is provided, the server
 * falls back to its shared tool inventory.
 */
export interface SessionToolFactory {
    /** Create the tool set for a newly initialized session. */
    create(): SessionToolSet;
}
