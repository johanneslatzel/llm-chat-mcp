import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Tool, ToolPackage } from '@johannes.latzel/llm-chat';
import { toolSchemaToZod } from '../lib/schema-converter.js';
import { toolResultsToMcp } from '../lib/result-converter.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { Mutex } from 'async-mutex';

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
    protected _registeredItems: (Tool | ToolPackage)[] = [];

    constructor(serverInfo: ServerInfo) {
        this.serverInfo = serverInfo;
        this.mcpServer = new McpServer(serverInfo);
    }

    /**
     * Register one or more tools with the MCP server.
     * If the argument is a {@link ToolPackage} every tool in the package is
     * registered; otherwise the single tool is registered.
     * Duplicate tool **names** cause an error from the underlying SDK.
     */
    register(item: Tool | ToolPackage): void {
        this._registeredItems.push(item);
        this.registerOnServer(this.mcpServer, item);
    }

    /** Register tools from one item onto a given McpServer instance. */
    protected registerOnServer(mcpServer: McpServer, item: Tool | ToolPackage): void {
        const tools = item instanceof ToolPackage ? item.tools() : [item];
        for (const tool of tools) {
            const zodSchema = toolSchemaToZod(tool);
            mcpServer.registerTool(
                tool.name,
                {
                    description: tool.description,
                    inputSchema: zodSchema
                },
                async (args: Record<string, unknown>) => {
                    const results = await tool.execute(args);
                    return toolResultsToMcp(results);
                }
            );
        }
    }

    /** Create a fresh McpServer with all registered tools. */
    protected createFreshMcpServer(): McpServer {
        const mcpServer = new McpServer(this.serverInfo);
        for (const item of this._registeredItems) {
            this.registerOnServer(mcpServer, item);
        }
        return mcpServer;
    }

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
};

export class HttpMcpServer extends BaseMcpServer {
    private expressApp;
    private expressServer: Server | null;
    private port: number;
    private sessions: Map<string, McpSession>;
    private mutex;

    constructor(serverInfo: HttpServerInfo) {
        super(serverInfo);
        this.port = serverInfo.port;
        this.expressServer = null;
        this.sessions = new Map();
        this.expressApp = express();
        this.mutex = new Mutex();
        this.expressApp.all('/mcp', (req, res) => this.handleMcpRequest(req, res));
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

            await this.handleCreateSession(req, res);
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
        await session.transport.handleRequest(req, res);
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
        const mcpServer = this.createFreshMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
                createdSessionId = sid;
            }
        });
        await mcpServer.connect(transport as unknown as Transport);
        await transport.handleRequest(req, res);

        if (createdSessionId) {
            await this.setSession(createdSessionId, { transport, mcpServer });
        } else {
            await transport.close();
        }
    }

    /** Start the Express listener. */
    async start(): Promise<void> {
        if (this.expressServer !== null) return;
        this.expressServer = this.expressApp.listen(this.port);
    }

    /** Stop the Express listener and close all sessions. */
    async onStop(): Promise<void> {
        const sessions = await this.clearSessions();
        for (const [, session] of sessions) {
            await session.transport.close();
        }
        this.expressServer?.close();
        this.expressServer = null;
    }
}
