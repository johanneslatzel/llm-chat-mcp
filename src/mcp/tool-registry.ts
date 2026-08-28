import { Tool, ToolPackage } from '@johannes.latzel/llm-chat';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerToolOnServer } from './tool-registration.js';
import type { McpServerObserver } from './observer.js';

/** One registered tool together with its current enable state. */
export interface ToolState {
    tool: Tool;
    enabled: boolean;
}

/**
 * The tool model of an MCP server: every registered tool plus the set of
 * disabled tools. The registry is the single source of truth for the
 * inventory and its enable state and deliberately holds no handles of its
 * own — the SDK materializes each server's tools as {@link RegisteredTool}
 * handles (one set on the base server, one per HTTP session), and the
 * registry pushes its state onto whatever handle set it is given via
 * {@link applyEnabledStateTo}.
 */
export class ToolRegistry {
    private _tools: Tool[] = [];
    private _disabled = new Set<string>();
    private readonly observer: McpServerObserver | undefined;

    /**
     * @param observer  Optional observer notified about every tool call. Used
     *                  for logging and monitoring without touching tool logic.
     */
    constructor(observer?: McpServerObserver) {
        this.observer = observer;
    }

    /** Names of every registered tool, in registration order. */
    get names(): string[] {
        return this._tools.map((tool) => tool.name);
    }

    /** Sorted disabled tool names, ready for persistence. */
    get disabled(): string[] {
        return [...this._disabled].sort();
    }

    /** Read-only snapshot of each registered tool with its current state. */
    get toolStates(): ToolState[] {
        return this._tools.map((tool) => ({ tool, enabled: this.isEnabled(tool.name) }));
    }

    /** Whether the named tool is currently enabled. */
    isEnabled(name: string): boolean {
        return !this._disabled.has(name);
    }

    /** Replace the disabled set. Pass an empty list to re-enable every tool. */
    setDisabled(names: string[]): void {
        this._disabled = new Set(names);
    }

    /** Enable a single tool by removing it from the disabled set. */
    enable(name: string): void {
        this._disabled.delete(name);
    }

    /** Disable a single tool by adding it to the disabled set. */
    disable(name: string): void {
        this._disabled.add(name);
    }

    /**
     * Register one item's tools with an SDK server, adding them to the
     * inventory. Newly registered tools are enabled unless already listed
     * in the disabled set. Returns the SDK handles keyed by tool name.
     * Duplicate tool names cause an error from the underlying SDK.
     */
    registerOn(server: McpServer, item: Tool | ToolPackage): Map<string, RegisteredTool> {
        const handles = new Map<string, RegisteredTool>();
        const tools = item instanceof ToolPackage ? item.tools() : [item];
        for (const tool of tools) {
            this._tools.push(tool);
            handles.set(tool.name, this.registerOne(server, tool));
        }
        return handles;
    }

    /** Register every tool with a fresh SDK server, returning its handles. */
    registerAllOn(server: McpServer): Map<string, RegisteredTool> {
        const handles = new Map<string, RegisteredTool>();
        for (const tool of this._tools) {
            handles.set(tool.name, this.registerOne(server, tool));
        }
        return handles;
    }

    /** Push the current enable state onto a set of SDK handles. */
    applyEnabledStateTo(handles: Map<string, RegisteredTool>): void {
        for (const [name, registered] of handles) {
            const enabled = this.isEnabled(name);
            if (registered.enabled === enabled) {
                continue;
            }
            if (enabled) {
                registered.enable();
            } else {
                registered.disable();
            }
        }
    }

    private registerOne(server: McpServer, tool: Tool): RegisteredTool {
        return registerToolOnServer(server, tool, this.observer);
    }
}
