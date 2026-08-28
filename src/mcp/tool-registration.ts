import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@johannes.latzel/llm-chat';
import { toolSchemaToZod } from '../lib/schema-converter.js';
import { toolResultsToMcp } from '../lib/result-converter.js';
import type { McpServerObserver } from './observer.js';

/**
 * Registers a single llm-chat {@link Tool} with an SDK `McpServer`.
 *
 * Converts the tool's parameter schema to zod, installs the tool call handler
 * that executes the tool and reports to the observer, and returns the SDK
 * handle so the caller can later push enable/disable state onto it.
 *
 * Shared by {@link ToolRegistry} (for the shared inventory) and by the HTTP
 * server (for session-scoped tool sets produced by a factory), so every tool
 * on every server observes the same wiring.
 *
 * @param server   - SDK server to register the tool on.
 * @param tool     - llm-chat tool to register.
 * @param observer - Optional observer notified about tool calls.
 * @returns The SDK `RegisteredTool` handle for the tool.
 */
export function registerToolOnServer(
    server: McpServer,
    tool: Tool,
    observer?: McpServerObserver
): RegisteredTool {
    const zodSchema = toolSchemaToZod(tool);
    return server.registerTool(
        tool.name,
        {
            description: tool.description,
            inputSchema: zodSchema
        },
        async (args: Record<string, unknown>) => {
            const started = Date.now();
            try {
                const results = await tool.execute(args);
                observer?.onToolCall({
                    name: tool.name,
                    args,
                    result: results,
                    durationMs: Date.now() - started
                });
                return toolResultsToMcp(results);
            } catch (error) {
                observer?.onToolCall({
                    name: tool.name,
                    args,
                    error: error instanceof Error ? error.message : String(error),
                    durationMs: Date.now() - started
                });
                throw error;
            }
        }
    );
}
