import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { StdioMcpServer } from '../index.js';
import { TestTool, TestPackage } from '../helper/test-tools.js';
import { DocumentKind } from '../../src/mcp/document-resource.js';
import {
    ServerEvent,
    ServerHookEmitter,
    McpServerHookBuilder,
    HttpServerHookBuilder
} from '../../src/hooks/server-hooks.js';

describe('ServerHookEmitter', () => {
    it('subscribes and unsubscribes handlers', async () => {
        const emitter = new ServerHookEmitter();
        const handler = vi.fn();
        const off = emitter.on(ServerEvent.Started, handler);
        await emitter.emit(ServerEvent.Started);
        expect(handler).toHaveBeenCalledTimes(1);
        off();
        await emitter.emit(ServerEvent.Started);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits only to handlers of the fired event', async () => {
        const emitter = new ServerHookEmitter();
        const started = vi.fn();
        const tool = vi.fn();
        emitter.on(ServerEvent.Started, started);
        emitter.on(ServerEvent.ToolRegistered, tool);
        await emitter.emit(ServerEvent.ToolRegistered, 'a');
        expect(tool).toHaveBeenCalledWith('a');
        expect(started).not.toHaveBeenCalled();
    });

    it('off on an unknown event does nothing', () => {
        const emitter = new ServerHookEmitter();
        const handler = vi.fn();
        emitter.off(ServerEvent.Started, handler);
        expect(handler).not.toHaveBeenCalled();
    });

    it('emit with no handlers resolves silently', async () => {
        const emitter = new ServerHookEmitter();
        await expect(emitter.emit(ServerEvent.Started)).resolves.toBeUndefined();
    });
});

describe('McpServerHookBuilder', () => {
    it('started() registers a disposable hook that fires on emit', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const handler = vi.fn();
        builder.started().do(handler);
        await emitter.emit(ServerEvent.Started);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('toolRegistered() without names fires for every tool', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const handler = vi.fn();
        builder.toolRegistered().do(handler);
        await emitter.emit(ServerEvent.ToolRegistered, 'a');
        await emitter.emit(ServerEvent.ToolRegistered, 'b');
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('toolRegistered() with names fires only for matching tools', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const handler = vi.fn();
        builder.toolRegistered('a').do(handler);
        await emitter.emit(ServerEvent.ToolRegistered, 'a');
        await emitter.emit(ServerEvent.ToolRegistered, 'b');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('a');
    });

    it('documentRegistered() passes the info payload through', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const handler = vi.fn();
        builder.documentRegistered().do(handler);
        const info = { kind: DocumentKind.Content, name: 'notes' };
        await emitter.emit(ServerEvent.DocumentRegistered, info);
        expect(handler).toHaveBeenCalledWith(info);
    });

    it('multiple subscribers all fire in registration order', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const order: string[] = [];
        builder.started().do(() => {
            order.push('first');
        });
        builder.started().do(() => {
            order.push('second');
        });
        await emitter.emit(ServerEvent.Started);
        expect(order).toEqual(['first', 'second']);
    });

    it('dispose unsubscribes and is idempotent', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const handler = vi.fn();
        const hook = builder.started().do(handler);
        await emitter.emit(ServerEvent.Started);
        expect(handler).toHaveBeenCalledTimes(1);
        hook.dispose();
        hook.dispose();
        await emitter.emit(ServerEvent.Started);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('a throwing callback is swallowed and does not stop other callbacks', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const second = vi.fn();
        builder.started().do(() => {
            throw new Error('boom');
        });
        builder.started().do(second);
        await emitter.emit(ServerEvent.Started);
        expect(second).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('an async callback that rejects is caught and logged', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        builder.started().do(async () => {
            throw new Error('async boom');
        });
        await expect(emitter.emit(ServerEvent.Started)).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('a hook disposed mid-emit by another callback is skipped (isDisposed guard)', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const second = vi.fn();
        let secondHook: { dispose(): void } | undefined;
        builder.started().do(() => {
            secondHook?.dispose();
        });
        const h2 = builder.started().do(second);
        secondHook = h2;
        await emitter.emit(ServerEvent.Started);
        expect(second).not.toHaveBeenCalled();
    });

    it('a toolRegistered hook disposed mid-emit is skipped', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const second = vi.fn();
        let secondHook: { dispose(): void } | undefined;
        builder.toolRegistered().do(() => {
            secondHook?.dispose();
        });
        const h2 = builder.toolRegistered().do(second);
        secondHook = h2;
        await emitter.emit(ServerEvent.ToolRegistered, 'a');
        expect(second).not.toHaveBeenCalled();
    });

    it('a documentRegistered hook disposed mid-emit is skipped', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new McpServerHookBuilder(emitter);
        const second = vi.fn();
        let secondHook: { dispose(): void } | undefined;
        builder.documentRegistered().do(() => {
            secondHook?.dispose();
        });
        const h2 = builder.documentRegistered().do(second);
        secondHook = h2;
        await emitter.emit(ServerEvent.DocumentRegistered, { kind: DocumentKind.File, name: 'a' });
        expect(second).not.toHaveBeenCalled();
    });

    it('a session hook disposed mid-emit is skipped', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new HttpServerHookBuilder(emitter);
        const second = vi.fn();
        let secondHook: { dispose(): void } | undefined;
        builder.sessionCreated().do(() => {
            secondHook?.dispose();
        });
        const h2 = builder.sessionCreated().do(second);
        secondHook = h2;
        await emitter.emit(ServerEvent.SessionCreated, 'sid-1');
        expect(second).not.toHaveBeenCalled();
    });
});

describe('HttpServerHookBuilder', () => {
    it('sessionCreated and sessionDisposed fire with the session id', async () => {
        const emitter = new ServerHookEmitter();
        const builder = new HttpServerHookBuilder(emitter);
        const created = vi.fn();
        const disposed = vi.fn();
        builder.sessionCreated().do(created);
        builder.sessionDisposed().do(disposed);
        await emitter.emit(ServerEvent.SessionCreated, 'sid-1');
        await emitter.emit(ServerEvent.SessionDisposed, 'sid-1');
        expect(created).toHaveBeenCalledWith('sid-1');
        expect(disposed).toHaveBeenCalledWith('sid-1');
    });
});

describe('BaseMcpServer hook emit sites', () => {
    it('registerTool emits toolRegistered once per tool including packages', () => {
        const server = new StdioMcpServer({ name: 'test-server', version: '1.0.0' });
        const handler = vi.fn();
        server.hook().toolRegistered().do(handler);
        server.registerTool(new TestTool('single'));
        server.registerTool(new TestPackage());
        expect(handler).toHaveBeenCalledTimes(3);
        expect(handler).toHaveBeenCalledWith('single');
        expect(handler).toHaveBeenCalledWith('pkg-tool-a');
        expect(handler).toHaveBeenCalledWith('pkg-tool-b');
    });

    it('registerDocument emits documentRegistered with the file kind and name', () => {
        const server = new StdioMcpServer({ name: 'test-server', version: '1.0.0' });
        const handler = vi.fn();
        server.hook().documentRegistered().do(handler);
        const notes = path.resolve('tests/helper/docs/notes.md');
        server.registerDocument(notes);
        expect(handler).toHaveBeenCalledWith({ kind: DocumentKind.File, name: 'notes.md' });
    });

    it('registerFolder emits documentRegistered with the folder kind and no name', () => {
        const server = new StdioMcpServer({ name: 'test-server', version: '1.0.0' });
        const handler = vi.fn();
        server.hook().documentRegistered().do(handler);
        const folder = path.resolve('tests/helper/docs');
        server.registerFolder(folder);
        expect(handler).toHaveBeenCalledWith({ kind: DocumentKind.Folder });
    });

    it('registerContentDocument emits documentRegistered with the content kind and name', () => {
        const server = new StdioMcpServer({ name: 'test-server', version: '1.0.0' });
        const handler = vi.fn();
        server.hook().documentRegistered().do(handler);
        server.registerContentDocument({ name: 'readme', content: '# Readme' });
        expect(handler).toHaveBeenCalledWith({ kind: DocumentKind.Content, name: 'readme' });
    });

    it('toolRegistered name filter matches emitted tool names', () => {
        const server = new StdioMcpServer({ name: 'test-server', version: '1.0.0' });
        const handler = vi.fn();
        server.hook().toolRegistered('single').do(handler);
        server.registerTool(new TestTool('single'));
        server.registerTool(new TestTool('other'));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('single');
    });

    it('StdioMcpServer.start() emits started after connect', async () => {
        const server = new StdioMcpServer({ name: 'test-server', version: '1.0.0' });
        const handler = vi.fn();
        server.hook().started().do(handler);
        await server.start();
        expect(handler).toHaveBeenCalledTimes(1);
        await server.stop();
    });
});
