import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Tool, ToolPackage } from '@johannes.latzel/llm-chat';
import { ToolRegistry } from './tool-registry.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { Mutex } from 'async-mutex';
import {
    createContentEntry,
    createDocumentEntry,
    createFolderEntry,
    ContentDocumentConfig,
    DocumentEntry,
    DocumentKind,
    FileDocumentConfig,
    FolderDocumentConfig,
    registerContentDocumentOnServer,
    registerFileResourceOnServer,
    registerFolderResourcesOnServer
} from './document-resource.js';
import type { McpServerObserver } from './observer.js';
import { registerToolOnServer } from './tool-registration.js';
import type { SessionToolFactory, SessionToolSet } from './session-tools.js';
import {
    DISCOVER_METHOD,
    inspectSessionlessPost,
    respondMethodNotFound
} from './discovery-probe.js';
import {
    HttpServerHookBuilder,
    McpServerHookBuilder,
    ServerEvent,
    ServerHookEmitter
} from '../hooks/server-hooks.js';

/** Metadata passed to the MCP protocol on connect. */
export type ServerInfo = {
    name: string;
    version: string;
};

/** Extends {@link ServerInfo} with the port the HTTP server should bind to. */
export type HttpServerInfo = ServerInfo & {
    port: number;
};

/**
 * Abstract MCP server that wraps the SDK's `McpServer` and exposes a
 * `register()` method accepting llm-chat `Tool` / `ToolPackage` instances.
 *
 * Concrete subclasses must implement {@link start} to connect the server to
 * a specific transport.
 */
export abstract class BaseMcpServer {
    private mcpServer: McpServer;
    protected serverInfo: ServerInfo;
    /** Observer notified about tool calls and resource reads; shared by base server and every session. */
    protected readonly observer: McpServerObserver | undefined;
    protected _registeredDocuments: DocumentEntry[] = [];
    /**
     * The tool model: every registered llm-chat `Tool` plus the disabled-tool
     * policy. The single source of truth for the inventory and its enable
     * state, shared by the base server and every HTTP session (see
     * {@link createFreshMcpServer}).
     */
    protected tools: ToolRegistry;
    /**
     * The base server's view over {@link tools}: the SDK `RegisteredTool`
     * handles of {@link mcpServer}, keyed by tool name. Kept separate from the
     * registry because the SDK materializes one handle set per server - the
     * base server plus one fresh server per HTTP session - and the registry
     * must stay server-agnostic to push state onto all of them. Applies
     * enable/disable changes to the connected (stdio) server live; for HTTP
     * the base server is never connected, so this map is bookkeeping only.
     */
    private baseToolHandles = new Map<string, RegisteredTool>();
    /** Emitter backing the {@link hook} builder; fires lifecycle events. */
    protected readonly hookEmitter = new ServerHookEmitter();

    constructor(serverInfo: ServerInfo, observer?: McpServerObserver) {
        this.serverInfo = serverInfo;
        this.observer = observer;
        this.tools = new ToolRegistry(observer);
        this.mcpServer = new McpServer(serverInfo);
    }

    /**
     * Register one or more tools with the MCP server.
     * If the argument is a {@link ToolPackage} every tool in the package is
     * registered; otherwise the single tool is registered.
     * Duplicate tool **names** cause an error from the underlying SDK.
     */
    registerTool(item: Tool | ToolPackage): void {
        const handles = this.tools.registerOn(this.mcpServer, item);
        for (const [name, registered] of handles) {
            this.baseToolHandles.set(name, registered);
            this.hookEmitter.emit(ServerEvent.ToolRegistered, name);
        }
        // A tool registered after being listed in the disabled set must start
        // disabled on the base server.
        this.tools.applyEnabledStateTo(this.baseToolHandles);
    }

    /**
     * Access lifecycle hooks: `started`, `toolRegistered`,
     * `documentRegistered`, and on HTTP servers `sessionCreated` /
     * `sessionDisposed`. Each builder's `do(callback)` registers the callback
     * and returns a disposable {@link Hook}.
     */
    hook(): McpServerHookBuilder {
        return new McpServerHookBuilder(this.hookEmitter);
    }

    /**
     * Register a single file as an MCP resource.
     * Accepts either a path or a {@link FileDocumentConfig}. The file becomes a
     * static resource at a `file://` URI and its content is read lazily on
     * `resources/read`. A non-file path causes an error.
     */
    registerDocument(config: FileDocumentConfig): void;
    registerDocument(path: string): void;
    registerDocument(pathOrConfig: string | FileDocumentConfig): void {
        const entry = createDocumentEntry(
            typeof pathOrConfig === 'string' ? { path: pathOrConfig } : pathOrConfig
        );
        this._registeredDocuments.push(entry);
        registerFileResourceOnServer(this.mcpServer, entry, this.observer);
        this.hookEmitter.emit(ServerEvent.DocumentRegistered, {
            kind: entry.kind,
            name: entry.name
        });
    }

    /**
     * Register every matching file in a folder as an MCP resource.
     * Accepts either a path or a {@link FolderDocumentConfig}. Matching files
     * (default: all supported types) are collected recursively and each becomes
     * a static resource; a folder without matches registers nothing. A non-folder
     * path causes an error.
     */
    registerFolder(config: FolderDocumentConfig): void;
    registerFolder(path: string): void;
    registerFolder(pathOrConfig: string | FolderDocumentConfig): void {
        const entry = createFolderEntry(
            typeof pathOrConfig === 'string' ? { path: pathOrConfig } : pathOrConfig
        );
        this._registeredDocuments.push(entry);
        registerFolderResourcesOnServer(this.mcpServer, entry, this.observer);
        this.hookEmitter.emit(ServerEvent.DocumentRegistered, { kind: entry.kind });
    }

    /**
     * Register an in-memory content string or provider as an MCP resource.
     * The content is served from RAM on every `resources/read` — no file on
     * disk is involved. The resource URI uses the `content://` scheme.
     */
    registerContentDocument(config: ContentDocumentConfig): void {
        const entry = createContentEntry(config);
        this._registeredDocuments.push(entry);
        registerContentDocumentOnServer(this.mcpServer, entry, this.observer);
        this.hookEmitter.emit(ServerEvent.DocumentRegistered, {
            kind: entry.kind,
            name: entry.name
        });
    }

    /**
     * Disable exactly the named tools on the base server and all active
     * sessions. The set also applies to sessions created later. Pass an
     * empty list to re-enable all tools. Use this when applying a persisted
     * disabled set; for a single runtime toggle use {@link enableTool} or
     * {@link disableTool}.
     */
    setDisabledTools(names: string[]): void {
        this.tools.setDisabled(names);
        this.applyToolState();
    }

    /** Enable a single tool on the base server and all active sessions. */
    enableTool(name: string): void {
        this.tools.enable(name);
        this.applyToolState();
    }

    /** Disable a single tool on the base server and all active sessions. */
    disableTool(name: string): void {
        this.tools.disable(name);
        this.applyToolState();
    }

    /** Push the current tool state onto the base server and every active session. */
    private applyToolState(): void {
        this.tools.applyEnabledStateTo(this.baseToolHandles);
        this.applyDisabledToSessions();
    }

    /** Hook for subclasses to apply the disabled-tool set to per-transport sessions. */
    protected applyDisabledToSessions(): void {}

    /** Connect the underlying `McpServer` to a transport. */
    protected async connect(transport: Transport): Promise<void> {
        await this.mcpServer.connect(transport);
    }

    /** Start the server (bind to its transport). Must be called once before accepting requests. */
    abstract start(): Promise<void>;

    /** Gracefully shut down the server, running the subclass {@link onStop} hook first. */
    async stop(): Promise<void> {
        await this.onStop();
        await this.mcpServer.close();
    }

    /** Lifecycle hook called before the MCP server socket closes. Override to clean up transport resources. */
    protected async onStop(): Promise<void> {}
}

/** MCP server that communicates over standard input / output (stdio). */
export class StdioMcpServer extends BaseMcpServer {
    async start(): Promise<void> {
        await this.connect(new StdioServerTransport());
        this.hookEmitter.emit(ServerEvent.Started);
    }
}

/**
 * MCP server that communicates over Streamable HTTP using Express.
 * Each client session gets its own `StreamableHTTPServerTransport` + `McpServer`
 * pair, allowing multiple concurrent HTTP clients.
 */
type McpSession = {
    transport: StreamableHTTPServerTransport;
    mcpServer: McpServer;
    tools: Map<string, RegisteredTool>;
    /** Session-scoped tool set from the factory, disposed when the session ends. */
    sessionToolSet?: SessionToolSet;
};

export class HttpMcpServer extends BaseMcpServer {
    private expressApp;
    private expressServer: Server | null;
    private port: number;
    private sessions: Map<string, McpSession>;
    private mutex;
    private readonly sessionToolFactory: SessionToolFactory | undefined;

    constructor(
        serverInfo: HttpServerInfo,
        observer?: McpServerObserver,
        sessionToolFactory?: SessionToolFactory
    ) {
        super(serverInfo, observer);
        this.port = serverInfo.port;
        this.expressServer = null;
        this.sessions = new Map();
        this.expressApp = express();
        this.mutex = new Mutex();
        this.sessionToolFactory = sessionToolFactory;
        this.expressApp.all('/mcp', (req, res) => this.handleMcpRequest(req, res));
    }

    /**
     * Access lifecycle hooks including the HTTP session events
     * (`sessionCreated` / `sessionDisposed`). Each builder's `do(callback)`
     * registers the callback and returns a disposable {@link Hook}.
     */
    override hook(): HttpServerHookBuilder {
        return new HttpServerHookBuilder(this.hookEmitter);
    }

    /**
     * Create a fresh McpServer for a new HTTP session: registers the shared
     * tool inventory plus, when a {@link SessionToolFactory} is configured,
     * the session-scoped tool set produced by the factory. Documents and the
     * disabled-tool policy are applied to the fresh server.
     */
    private createFreshMcpServer(): {
        mcpServer: McpServer;
        tools: Map<string, RegisteredTool>;
        sessionToolSet: SessionToolSet | undefined;
    } {
        const mcpServer = new McpServer(this.serverInfo);
        let sessionToolSet: SessionToolSet | undefined;

        if (this.sessionToolFactory) {
            sessionToolSet = this.sessionToolFactory.create();
        }

        const tools = this.tools.registerAllOn(mcpServer);
        if (sessionToolSet) {
            for (const item of sessionToolSet.tools) {
                const instances = item instanceof ToolPackage ? item.tools() : [item];
                for (const tool of instances) {
                    tools.set(tool.name, registerToolOnServer(mcpServer, tool, this.observer));
                }
            }
        }
        this.registerDocumentsOn(mcpServer);
        this.tools.applyEnabledStateTo(tools);
        return { mcpServer, tools, sessionToolSet };
    }

    /** Register every configured document resource on the given fresh server. */
    private registerDocumentsOn(mcpServer: McpServer): void {
        for (const entry of this._registeredDocuments) {
            switch (entry.kind) {
                case DocumentKind.File:
                    registerFileResourceOnServer(mcpServer, entry, this.observer);
                    break;
                case DocumentKind.Folder:
                    registerFolderResourcesOnServer(mcpServer, entry, this.observer);
                    break;
                case DocumentKind.Content:
                    registerContentDocumentOnServer(mcpServer, entry, this.observer);
                    break;
            }
        }
    }

    /** Look up a session by ID under the mutex. Returns `null` if not found. */
    private async getSession(sessionId: string): Promise<McpSession | null> {
        return this.mutex.runExclusive(() => this.sessions.get(sessionId) ?? null);
    }

    /** Atomically remove and return a session by ID. Returns `null` if not found. */
    private async removeSession(sessionId: string): Promise<McpSession | null> {
        return this.mutex.runExclusive(() => {
            const s = this.sessions.get(sessionId);
            if (s) this.sessions.delete(sessionId);
            return s ?? null;
        });
    }

    /** Store a session under the given ID under the mutex. */
    private async setSession(sessionId: string, session: McpSession): Promise<void> {
        await this.mutex.runExclusive(() => {
            this.sessions.set(sessionId, session);
        });
    }

    /** Atomically snapshot and clear all sessions. Returns the captured map. */
    private async clearSessions(): Promise<Map<string, McpSession>> {
        return this.mutex.runExclusive(() => {
            const entries = new Map(this.sessions);
            this.sessions.clear();
            return entries;
        });
    }

    /**
     * Dispatcher for `/mcp` requests.
     *
     * Routes by HTTP method and session presence:
     * - **DELETE** → {@link handleDelete}
     * - **Known session** → {@link handleExistingSession}
     * - **POST, no session** → {@link handleCreateSession}
     * - **Other** → 400
     */
    private async handleMcpRequest(req: express.Request, res: express.Response): Promise<void> {
        try {
            const sessionId = req.headers['mcp-session-id'] as string | undefined;

            if (req.method === 'DELETE') {
                await this.handleDelete(sessionId, req, res);
                return;
            }

            if (sessionId) {
                await this.handleExistingSession(sessionId, req, res);
                return;
            }

            if (req.method !== 'POST') {
                res.status(400).end();
                return;
            }

            // A session-less POST may be a server/discover probe from a modern
            // client. Answer it with 200 + JSON-RPC -32601 so the client falls
            // back to the legacy initialize handshake, without creating a
            // session. Non-probe POSTs are replayed byte-identically into
            // handleCreateSession so initialize handling is unchanged.
            const inspected = await inspectSessionlessPost(req);
            if (inspected.method === DISCOVER_METHOD) {
                respondMethodNotFound(res, inspected.id);
                return;
            }
            await this.handleCreateSession(inspected.replay() as unknown as express.Request, res);
        } catch {
            if (!res.headersSent) {
                res.status(500).end();
            } else {
                res.destroy();
            }
        }
    }

    /** Handle `DELETE /mcp` – disconnect a session. 404 if the session ID is unknown or missing. */
    private async handleDelete(
        sessionId: string | undefined,
        req: express.Request,
        res: express.Response
    ): Promise<void> {
        if (!sessionId) {
            res.status(404).end();
            return;
        }
        const session = await this.removeSession(sessionId);
        if (!session) {
            res.status(404).end();
            return;
        }
        await this.disposeSessionToolSet(session.sessionToolSet);
        await session.transport.handleRequest(req, res);
        this.hookEmitter.emit(ServerEvent.SessionDisposed, sessionId);
    }

    /** Route a request to an existing session. 404 if the session ID is unknown. */
    private async handleExistingSession(
        sessionId: string,
        req: express.Request,
        res: express.Response
    ): Promise<void> {
        const session = await this.getSession(sessionId);
        if (!session) {
            res.status(404).end();
            return;
        }
        await session.transport.handleRequest(req, res);
    }

    /**
     * Handle an initial `POST /mcp` (no session ID) – create a new transport,
     * connect a fresh McpServer, process the request, and store the session.
     * Closes the transport if initialization does not yield a session ID.
     */
    private async handleCreateSession(req: express.Request, res: express.Response): Promise<void> {
        let createdSessionId: string | null = null;
        const { mcpServer, tools, sessionToolSet } = this.createFreshMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
                createdSessionId = sid;
            }
        });
        await mcpServer.connect(transport as unknown as Transport);
        await transport.handleRequest(req, res);

        if (createdSessionId) {
            await this.setSession(createdSessionId, {
                transport,
                mcpServer,
                tools,
                ...(sessionToolSet !== undefined ? { sessionToolSet } : {})
            });
            this.hookEmitter.emit(ServerEvent.SessionCreated, createdSessionId);
        } else {
            await this.disposeSessionToolSet(sessionToolSet);
            await transport.close();
        }
    }

    /** Awaits a session tool set's dispose hook, swallowing errors so cleanup never blocks teardown. */
    private async disposeSessionToolSet(sessionToolSet: SessionToolSet | undefined): Promise<void> {
        if (!sessionToolSet) {
            return;
        }
        try {
            await sessionToolSet.dispose();
        } catch (error) {
            console.warn(
                `failed to dispose session tool set: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /** Apply the disabled-tool set to every active HTTP session. */
    protected applyDisabledToSessions(): void {
        for (const session of this.sessions.values()) {
            this.tools.applyEnabledStateTo(session.tools);
        }
    }

    /** Start the Express listener. */
    async start(): Promise<void> {
        if (this.expressServer !== null) return;
        this.expressServer = this.expressApp.listen(this.port);
        this.hookEmitter.emit(ServerEvent.Started);
    }

    /** Stop the Express listener, close all sessions, and destroy lingering connections. */
    async onStop(): Promise<void> {
        const sessions = await this.clearSessions();
        for (const [sessionId, session] of sessions) {
            await this.disposeSessionToolSet(session.sessionToolSet);
            await session.transport.close();
            this.hookEmitter.emit(ServerEvent.SessionDisposed, sessionId);
        }
        const server = this.expressServer;
        this.expressServer = null;
        if (server) {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }
}
