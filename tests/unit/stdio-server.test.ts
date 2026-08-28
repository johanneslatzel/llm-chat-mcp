import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioMcpServer } from '../index.js';
import { TestTool, TestToolError, TestPackage } from '../helper/test-tools.js';

describe('McpToolServer', () => {
    it('creates a server with valid info', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        expect(server).toBeInstanceOf(StdioMcpServer);
    });

    it('registers a single Tool', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        expect(() => server.registerTool(new TestTool('my-tool'))).not.toThrow();
    });

    it('registers a ToolPackage', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        expect(() => server.registerTool(new TestPackage())).not.toThrow();
    });

    it('throws when registering duplicate tool name', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        const tool = new TestTool('dup');
        server.registerTool(tool);
        expect(() => server.registerTool(tool)).toThrow();
    });

    it('executes a registered tool handler', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        const tool = new TestTool('echo');
        server.registerTool(tool);
        const registeredTools = (server as any).mcpServer._registeredTools as Record<
            string,
            { handler: Function }
        >;
        const registered = registeredTools['echo']!;
        const result = await registered.handler({ input: 'hello' }, {});
        expect(result.content[0]?.text).toBe('executed echo with hello');
    });

    it('starts and stops without error', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        await expect(server.start()).resolves.toBeUndefined();
        await expect(server.stop()).resolves.toBeUndefined();
    });

    it('restarts after stop', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        await server.start();
        await server.stop();
        await expect(server.start()).resolves.toBeUndefined();
        await server.stop();
    });

    it('returns error content when tool returns Error status', async () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        const tool = new TestToolError('failing');
        server.registerTool(tool);
        const registeredTools = (server as any).mcpServer._registeredTools as Record<
            string,
            { handler: Function }
        >;
        const registered = registeredTools['failing']!;
        const result = await registered.handler({ input: 'hello' }, {});
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toBe('error from failing');
    });

    it('threads a server observer to tool calls and resource reads', async () => {
        const onToolCall = vi.fn();
        const onResourceRead = vi.fn();
        const server = new StdioMcpServer(
            { name: 'test-server', version: '1.0.0' },
            { onToolCall, onResourceRead }
        );
        server.registerTool(new TestTool('echo'));
        const notes = path.resolve('tests/helper/docs/notes.md');
        server.registerDocument(notes);

        const registeredTools = (server as any).mcpServer._registeredTools as Record<
            string,
            { handler: Function }
        >;
        const toolResult = await registeredTools['echo']!.handler({ input: 'hello' }, {});
        expect(toolResult.content[0]?.text).toBe('executed echo with hello');
        expect(onToolCall).toHaveBeenCalledTimes(1);

        const registeredResources = (server as any).mcpServer._registeredResources as Record<
            string,
            { readCallback: (uri: URL) => Promise<unknown> }
        >;
        const uri = pathToFileURL(notes).toString();
        await registeredResources[uri]!.readCallback(new URL(uri));
        expect(onResourceRead).toHaveBeenCalledTimes(1);
    });
});

describe('tool state (StdioMcpServer)', () => {
    it('keeps all tools enabled by default', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(true);
    });

    it('disables the named tools', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.setDisabledTools(['b']);
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(false);
    });

    it('disables all tools when every name is listed', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.setDisabledTools(['a', 'b']);
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(false);
        expect(tools['b']!.enabled).toBe(false);
    });

    it('re-enables previously disabled tools for an empty list', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.setDisabledTools(['b']);
        server.setDisabledTools([]);
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(true);
    });

    it('ignores unknown tool names without throwing', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        expect(() => server.setDisabledTools(['unknown'])).not.toThrow();
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
    });

    it('disables a single tool live', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.registerTool(new TestTool('b'));
        server.disableTool('b');
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
        expect(tools['b']!.enabled).toBe(false);
    });

    it('enables a single tool live', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        server.disableTool('a');
        server.enableTool('a');
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
    });

    it('ignores unknown names for single-tool toggles', () => {
        const server = new StdioMcpServer({
            name: 'test-server',
            version: '1.0.0'
        });
        server.registerTool(new TestTool('a'));
        expect(() => server.disableTool('unknown')).not.toThrow();
        const tools = (server as any).mcpServer._registeredTools as Record<
            string,
            { enabled: boolean }
        >;
        expect(tools['a']!.enabled).toBe(true);
    });
});
