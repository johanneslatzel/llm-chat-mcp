# API Reference

## Classes

### `BaseMcpServer` (abstract)

Abstract base class for an MCP server. Holds registered tools and provides the
lifecycle contract.

```typescript
abstract class BaseMcpServer {
    constructor(serverInfo: ServerInfo);
    register(item: Tool | ToolPackage): void;
    abstract start(): Promise<void>;
    stop(): Promise<void>;
}
```

**`constructor(serverInfo)`**

Creates the underlying `McpServer` from `@modelcontextprotocol/sdk`.

| Parameter    | Type         | Description                         |
| ------------ | ------------ | ----------------------------------- |
| `serverInfo` | `ServerInfo` | `{ name: string; version: string }` |

**`register(item)`**

Registers a `Tool` or all tools in a `ToolPackage`. Duplicate tool **names**
cause an error from the SDK (not silently overwritten). Must be called before
`start()` — tools are snapshotted at session creation time.

| Parameter | Type                  | Description                                 |
| --------- | --------------------- | ------------------------------------------- |
| `item`    | `Tool \| ToolPackage` | Single tool or package of tools to register |

**`start()`** (abstract)

Subclasses implement this to connect the server to a transport.

**`stop()`**

Calls the `onStop()` lifecycle hook then closes the underlying `McpServer`.

---

### `StdioMcpServer`

MCP server over standard input/output. Extends `BaseMcpServer`.

```typescript
class StdioMcpServer extends BaseMcpServer {
    constructor(serverInfo: ServerInfo);
    start(): Promise<void>;
}
```

**`start()`**

Creates a `StdioServerTransport` and connects. Reads JSON-RPC messages from
stdin and writes responses to stdout.

---

### `HttpMcpServer`

MCP server over Streamable HTTP using Express. Each HTTP client gets its own
session. Extends `BaseMcpServer`.

```typescript
class HttpMcpServer extends BaseMcpServer {
    constructor(serverInfo: HttpServerInfo);
    start(): Promise<void>;
    stop(): Promise<void>;
}
```

**`constructor(serverInfo)`**

| Parameter    | Type             | Description                                       |
| ------------ | ---------------- | ------------------------------------------------- |
| `serverInfo` | `HttpServerInfo` | `{ name: string; version: string; port: number }` |

**`start()`**

Binds Express to the configured port. Idempotent — subsequent calls are no-ops
while the server is already listening.

**`stop()`**

Closes all active HTTP sessions (each transport is closed), clears the session
map, then stops the Express listener.

---

## Types

### `ServerInfo`

```typescript
type ServerInfo = {
    name: string;
    version: string;
};
```

Metadata sent to MCP clients during initialization.

### `HttpServerInfo`

```typescript
type HttpServerInfo = ServerInfo & {
    port: number;
};
```

Extends `ServerInfo` with the TCP port for Express to bind to.
