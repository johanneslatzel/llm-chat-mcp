import { Hook, HookBuilderBase } from '@johannes.latzel/llm-chat';
import { DocumentKind } from '../mcp/document-resource.js';

/** Information about a registered document, passed to `documentRegistered` hooks. */
export type DocumentRegisteredInfo = {
    kind: DocumentKind;
    /** Resource name. Omitted for folder registrations (folder resources are named per-file). */
    name?: string;
};

/** Names of the server hook events. */
export enum ServerEvent {
    Started = 'started',
    ToolRegistered = 'toolRegistered',
    DocumentRegistered = 'documentRegistered',
    SessionCreated = 'sessionCreated',
    SessionDisposed = 'sessionDisposed'
}

/** Payload shapes for every server hook event. */
type ServerEventMap = {
    [ServerEvent.Started]: [];
    [ServerEvent.ToolRegistered]: [name: string];
    [ServerEvent.DocumentRegistered]: [info: DocumentRegisteredInfo];
    [ServerEvent.SessionCreated]: [sessionId: string];
    [ServerEvent.SessionDisposed]: [sessionId: string];
};

/** A registered callback for a server event. */
type ServerHandler = (...args: never[]) => void | Promise<void>;

/**
 * Internal typed emitter backing the server hook builders. Holds one set of
 * handlers per event; `emit` invokes every subscribed handler with the event
 * payload. Errors thrown by callbacks are caught and logged, never propagated
 * to server code.
 */
export class ServerHookEmitter {
    private handlers = new Map<ServerEvent, Set<ServerHandler>>();

    /**
     * Subscribe a handler to an event. Returns an unsubscribe function; calling
     * it removes the handler so it stops firing.
     */
    on<E extends ServerEvent>(
        event: E,
        handler: (...args: ServerEventMap[E]) => void | Promise<void>
    ): () => void {
        let set = this.handlers.get(event);
        if (!set) {
            set = new Set();
            this.handlers.set(event, set);
        }
        set.add(handler as ServerHandler);
        return () => this.off(event, handler);
    }

    /** Remove a previously subscribed handler from an event. */
    off<E extends ServerEvent>(
        event: E,
        handler: (...args: ServerEventMap[E]) => void | Promise<void>
    ): void {
        const set = this.handlers.get(event);
        if (!set) return;
        set.delete(handler as ServerHandler);
    }

    /**
     * Fire an event to every subscribed handler. Callbacks are invoked via the
     * hooks' safe-invoke semantics (errors caught and logged); the emitter
     * itself never throws into server code.
     */
    async emit<E extends ServerEvent>(event: E, ...args: ServerEventMap[E]): Promise<void> {
        const set = this.handlers.get(event);
        if (!set) return;
        for (const handler of [...set]) {
            await (handler as (...args: ServerEventMap[E]) => void | Promise<void>)(...args);
        }
    }
}

/** Base class for server hook instances; unsubscribes from the emitter on dispose. */
abstract class BaseServerHook extends Hook {
    private readonly off: () => void;

    constructor(off: () => void) {
        super();
        this.off = off;
    }

    protected onDispose(): void {
        this.off();
    }
}

/** Hook for the `started` event. */
class StartedHook extends BaseServerHook {
    private readonly handler: () => void | Promise<void>;
    private readonly onEvent = async (): Promise<void> => {
        if (this.isDisposed()) return;
        await this.asyncSafeInvoke(() => this.handler());
    };

    constructor(emitter: ServerHookEmitter, handler: () => void | Promise<void>) {
        super(() => emitter.off(ServerEvent.Started, this.onEvent));
        this.handler = handler;
        emitter.on(ServerEvent.Started, this.onEvent);
    }
}

/** Hook for the `toolRegistered` event, optionally filtered by tool name. */
class ToolRegisteredHook extends BaseServerHook {
    private readonly names: string[] | undefined;
    private readonly handler: (name: string) => void | Promise<void>;
    private readonly onEvent = async (name: string): Promise<void> => {
        if (this.isDisposed()) return;
        if (this.matches(name)) {
            await this.asyncSafeInvoke(() => this.handler(name));
        }
    };

    constructor(
        emitter: ServerHookEmitter,
        names: string[] | undefined,
        handler: (name: string) => void | Promise<void>
    ) {
        super(() => emitter.off(ServerEvent.ToolRegistered, this.onEvent));
        this.names = names;
        this.handler = handler;
        emitter.on(ServerEvent.ToolRegistered, this.onEvent);
    }

    private matches(name: string): boolean {
        return this.names === undefined || this.names.includes(name);
    }
}

/** Hook for the `documentRegistered` event. */
class DocumentRegisteredHook extends BaseServerHook {
    private readonly handler: (info: DocumentRegisteredInfo) => void | Promise<void>;
    private readonly onEvent = async (info: DocumentRegisteredInfo): Promise<void> => {
        if (this.isDisposed()) return;
        await this.asyncSafeInvoke(() => this.handler(info));
    };

    constructor(
        emitter: ServerHookEmitter,
        handler: (info: DocumentRegisteredInfo) => void | Promise<void>
    ) {
        super(() => emitter.off(ServerEvent.DocumentRegistered, this.onEvent));
        this.handler = handler;
        emitter.on(ServerEvent.DocumentRegistered, this.onEvent);
    }
}

/** Hook for the `sessionCreated` / `sessionDisposed` events. */
class SessionHook extends BaseServerHook {
    private readonly handler: (sessionId: string) => void | Promise<void>;
    private readonly onEvent = async (sessionId: string): Promise<void> => {
        if (this.isDisposed()) return;
        await this.asyncSafeInvoke(() => this.handler(sessionId));
    };

    constructor(
        emitter: ServerHookEmitter,
        event: ServerEvent.SessionCreated | ServerEvent.SessionDisposed,
        handler: (sessionId: string) => void | Promise<void>
    ) {
        super(() => emitter.off(event, this.onEvent));
        this.handler = handler;
        emitter.on(event, this.onEvent);
    }
}

/** Filter builder for the `started` event. */
export class StartedFilterBuilder extends HookBuilderBase<() => void | Promise<void>> {
    constructor(private readonly emitter: ServerHookEmitter) {
        super();
    }

    do(callback: () => void | Promise<void>): Hook {
        return new StartedHook(this.emitter, callback);
    }
}

/** Filter builder for the `toolRegistered` event, optionally filtered by tool name. */
export class ToolRegisteredFilterBuilder extends HookBuilderBase<
    (name: string) => void | Promise<void>
> {
    constructor(
        private readonly emitter: ServerHookEmitter,
        private readonly names: string[] | undefined
    ) {
        super();
    }

    do(callback: (name: string) => void | Promise<void>): Hook {
        return new ToolRegisteredHook(this.emitter, this.names, callback);
    }
}

/** Filter builder for the `documentRegistered` event. */
export class DocumentRegisteredFilterBuilder extends HookBuilderBase<
    (info: DocumentRegisteredInfo) => void | Promise<void>
> {
    constructor(private readonly emitter: ServerHookEmitter) {
        super();
    }

    do(callback: (info: DocumentRegisteredInfo) => void | Promise<void>): Hook {
        return new DocumentRegisteredHook(this.emitter, callback);
    }
}

/** Filter builder for the `sessionCreated` / `sessionDisposed` events. */
export class SessionFilterBuilder extends HookBuilderBase<
    (sessionId: string) => void | Promise<void>
> {
    constructor(
        private readonly emitter: ServerHookEmitter,
        private readonly event: ServerEvent.SessionCreated | ServerEvent.SessionDisposed
    ) {
        super();
    }

    do(callback: (sessionId: string) => void | Promise<void>): Hook {
        return new SessionHook(this.emitter, this.event, callback);
    }
}

/** Entry point for building hooks on any MCP server. */
export class McpServerHookBuilder {
    constructor(protected readonly emitter: ServerHookEmitter) {}

    /** Build a hook that fires when the server has started. */
    started(): StartedFilterBuilder {
        return new StartedFilterBuilder(this.emitter);
    }

    /**
     * Build a hook that fires when a tool is registered. Pass tool names to
     * filter; with no names the hook fires for every tool.
     */
    toolRegistered(...names: string[]): ToolRegisteredFilterBuilder {
        return new ToolRegisteredFilterBuilder(this.emitter, names.length > 0 ? names : undefined);
    }

    /** Build a hook that fires when a document resource is registered. */
    documentRegistered(): DocumentRegisteredFilterBuilder {
        return new DocumentRegisteredFilterBuilder(this.emitter);
    }
}

/** Entry point for building hooks on an HTTP MCP server, adding session events. */
export class HttpServerHookBuilder extends McpServerHookBuilder {
    constructor(emitter: ServerHookEmitter) {
        super(emitter);
    }

    /** Build a hook that fires when an HTTP session is created. */
    sessionCreated(): SessionFilterBuilder {
        return new SessionFilterBuilder(this.emitter, ServerEvent.SessionCreated);
    }

    /** Build a hook that fires when an HTTP session is disposed. */
    sessionDisposed(): SessionFilterBuilder {
        return new SessionFilterBuilder(this.emitter, ServerEvent.SessionDisposed);
    }
}
