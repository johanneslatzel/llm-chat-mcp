import { describe, it, expect, vi } from 'vitest';
import {
    Tool,
    ToolPackage,
    ToolParameters,
    ToolParameterProperty,
    PartialToolResult,
    ResultStatus
} from '@johannes.latzel/llm-chat';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolRegistry } from '../index.js';

class TestTool extends Tool {
    constructor(name: string) {
        super(
            name,
            `Tool ${name}`,
            new ToolParameters(
                {
                    input: ToolParameterProperty.string('Input value')
                },
                ['input']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `executed ${this.name} with ${String(args.input)}`,
            status: ResultStatus.Success
        };
    }
}

class TestPackage extends ToolPackage {
    constructor() {
        super([new TestTool('pkg-tool-a'), new TestTool('pkg-tool-b')]);
    }
}

type FakeHandle = {
    description: string;
    inputSchema: unknown;
    enabled: boolean;
    enable: () => void;
    disable: () => void;
    handler: Function;
};

class FakeServer {
    registered = new Map<string, FakeHandle>();

    registerTool(
        name: string,
        spec: { description: string; inputSchema: unknown },
        handler: Function
    ): FakeHandle {
        const handle: FakeHandle = {
            description: spec.description,
            inputSchema: spec.inputSchema,
            enabled: true,
            enable: () => {
                handle.enabled = true;
            },
            disable: () => {
                handle.enabled = false;
            },
            handler
        };
        this.registered.set(name, handle);
        return handle;
    }
}

function asServer(fake: FakeServer): McpServer {
    return fake as unknown as McpServer;
}

describe('ToolRegistry', () => {
    it('lists registered tool names in registration order', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.registerOn(asServer(fake), new TestPackage());
        expect(registry.names).toEqual(['a', 'pkg-tool-a', 'pkg-tool-b']);
    });

    it('returns a sorted, empty-by-default disabled list', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.registerOn(asServer(fake), new TestTool('b'));
        expect(registry.disabled).toEqual([]);
        registry.setDisabled(['b', 'a']);
        expect(registry.disabled).toEqual(['a', 'b']);
    });

    it('derives the enable state for every registered tool', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.registerOn(asServer(fake), new TestTool('b'));
        registry.setDisabled(['b']);
        expect(registry.toolStates).toEqual([
            { tool: expect.any(TestTool), enabled: true },
            { tool: expect.any(TestTool), enabled: false }
        ]);
    });

    it('reports enabled status from the disabled set', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        expect(registry.isEnabled('a')).toBe(true);
        registry.setDisabled(['a']);
        expect(registry.isEnabled('a')).toBe(false);
    });

    it('replaces the disabled set on every call', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.registerOn(asServer(fake), new TestTool('b'));
        registry.setDisabled(['a']);
        registry.setDisabled(['b']);
        expect(registry.isEnabled('a')).toBe(true);
        expect(registry.isEnabled('b')).toBe(false);
    });

    it('registers a single tool and runs its handler', async () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        const handles = registry.registerOn(asServer(fake), new TestTool('echo'));
        expect(handles.size).toBe(1);
        expect(handles.has('echo')).toBe(true);
        const registered = fake.registered.get('echo')!;
        expect(registered.description).toBe('Tool echo');
        expect(registered.inputSchema).toBeDefined();
        const handler = registered.handler as (args: Record<string, unknown>) => Promise<{
            content: Array<{ text: string }>;
            isError: boolean;
        }>;
        const result = await handler({ input: 'hi' });
        expect(result.content[0]?.text).toBe('executed echo with hi');
    });

    it('registers every tool in a package', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        const handles = registry.registerOn(asServer(fake), new TestPackage());
        expect(registry.names).toEqual(['pkg-tool-a', 'pkg-tool-b']);
        expect(handles.has('pkg-tool-a')).toBe(true);
        expect(handles.has('pkg-tool-b')).toBe(true);
    });

    it('registers the full inventory on a fresh server', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.registerOn(asServer(fake), new TestPackage());
        const fresh = new FakeServer();
        const handles = registry.registerAllOn(asServer(fresh));
        expect([...fresh.registered.keys()]).toEqual(['a', 'pkg-tool-a', 'pkg-tool-b']);
        expect(handles.size).toBe(3);
    });

    it('disables handles for tools in the disabled set', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.setDisabled(['a']);
        const fresh = new FakeServer();
        const handles = registry.registerAllOn(asServer(fresh));
        expect(fresh.registered.get('a')!.enabled).toBe(true);
        registry.applyEnabledStateTo(handles);
        expect(fresh.registered.get('a')!.enabled).toBe(false);
    });

    it('enables handles for tools outside the disabled set', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        const fresh = new FakeServer();
        const handles = registry.registerAllOn(asServer(fresh));
        const handle = fresh.registered.get('a')!;
        handle.enabled = false;
        registry.applyEnabledStateTo(handles);
        expect(handle.enabled).toBe(true);
    });

    it('leaves handles whose state already matches untouched', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        const fresh = new FakeServer();
        const handles = registry.registerAllOn(asServer(fresh));
        const handle = fresh.registered.get('a')!;
        const enable = vi.spyOn(handle, 'enable');
        const disable = vi.spyOn(handle, 'disable');
        registry.applyEnabledStateTo(handles);
        expect(enable).not.toHaveBeenCalled();
        expect(disable).not.toHaveBeenCalled();
    });

    it('keeps a tool registered after disable listed as disabled', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.setDisabled(['b']);
        const handles = registry.registerOn(asServer(fake), new TestTool('b'));
        registry.applyEnabledStateTo(handles);
        expect(fake.registered.get('b')!.enabled).toBe(false);
    });

    it('keeps a tool registered after disable enabled by default', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.setDisabled(['b']);
        const handles = registry.registerOn(asServer(fake), new TestTool('c'));
        registry.applyEnabledStateTo(handles);
        expect(fake.registered.get('c')!.enabled).toBe(true);
    });

    it('disables a single tool', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.registerOn(asServer(fake), new TestTool('b'));
        registry.disable('a');
        expect(registry.isEnabled('a')).toBe(false);
        expect(registry.isEnabled('b')).toBe(true);
        expect(registry.disabled).toEqual(['a']);
    });

    it('enables a single tool', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.setDisabled(['a']);
        registry.enable('a');
        expect(registry.isEnabled('a')).toBe(true);
        expect(registry.disabled).toEqual([]);
    });

    it('ignores toggles for tools that are not registered', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        registry.disable('missing');
        expect(registry.isEnabled('a')).toBe(true);
        expect(registry.disabled).toEqual(['missing']);
        registry.enable('missing');
        expect(registry.disabled).toEqual([]);
    });

    it('pushes single-tool toggles onto handles', () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('a'));
        const fresh = new FakeServer();
        const handles = registry.registerAllOn(asServer(fresh));
        registry.disable('a');
        registry.applyEnabledStateTo(handles);
        expect(fresh.registered.get('a')!.enabled).toBe(false);
        registry.enable('a');
        registry.applyEnabledStateTo(handles);
        expect(fresh.registered.get('a')!.enabled).toBe(true);
    });
});


describe('McpServerObserver', () => {
    it('reports successful tool calls to the observer', async () => {
        const onToolCall = vi.fn();
        const registry = new ToolRegistry({ onToolCall, onResourceRead: vi.fn() });
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('echo'));
        const handler = fake.registered.get('echo')!.handler as (
            args: Record<string, unknown>
        ) => Promise<{ content: Array<{ text: string }>; isError: boolean }>;
        const result = await handler({ input: 'hi' });
        expect(result.content[0]?.text).toBe('executed echo with hi');
        expect(onToolCall).toHaveBeenCalledTimes(1);
        const info = onToolCall.mock.calls[0]![0];
        expect(info.name).toBe('echo');
        expect(info.args).toEqual({ input: 'hi' });
        expect(info.result).toBeDefined();
        expect(info.error).toBeUndefined();
        expect(info.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('reports thrown errors to the observer and rethrows', async () => {
        const onToolCall = vi.fn();
        const registry = new ToolRegistry({ onToolCall, onResourceRead: vi.fn() });
        const tool = new TestTool('bang');
        const execute = vi.spyOn(tool, 'execute').mockRejectedValue(new Error('tool exploded'));
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), tool);
        const handler = fake.registered.get('bang')!.handler as (
            args: Record<string, unknown>
        ) => Promise<unknown>;
        await expect(handler({ input: 'x' })).rejects.toThrow('tool exploded');
        expect(onToolCall).toHaveBeenCalledTimes(1);
        const info = onToolCall.mock.calls[0]![0];
        expect(info.name).toBe('bang');
        expect(info.error).toBe('tool exploded');
        expect(info.result).toBeUndefined();
        expect(info.durationMs).toBeGreaterThanOrEqual(0);
        execute.mockRestore();
    });

    it('reports non-Error throws using String(error)', async () => {
        const onToolCall = vi.fn();
        const registry = new ToolRegistry({ onToolCall, onResourceRead: vi.fn() });
        const tool = new TestTool('bang');
        const execute = vi.spyOn(tool, 'execute').mockRejectedValue('plain string error');
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), tool);
        const handler = fake.registered.get('bang')!.handler as (
            args: Record<string, unknown>
        ) => Promise<unknown>;
        await expect(handler({ input: 'x' })).rejects.toBe('plain string error');
        expect(onToolCall).toHaveBeenCalledTimes(1);
        expect(onToolCall.mock.calls[0]![0].error).toBe('plain string error');
        execute.mockRestore();
    });

    it('runs the handler without an observer configured', async () => {
        const registry = new ToolRegistry();
        const fake = new FakeServer();
        registry.registerOn(asServer(fake), new TestTool('echo'));
        const handler = fake.registered.get('echo')!.handler as (
            args: Record<string, unknown>
        ) => Promise<unknown>;
        await expect(handler({ input: 'hi' })).resolves.toBeDefined();
    });
});
