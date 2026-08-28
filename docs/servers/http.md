# HttpMcpServer

MCP server over Streamable HTTP using Express. Each HTTP client gets its own
session. Extends [`BaseMcpServer`](base.md). See
[`src/mcp/mcp-server.ts`](../../src/mcp/mcp-server.ts) for the full signature.

## `constructor(serverInfo, observer?, sessionToolFactory?)`

| Parameter            | Type                  | Description                                                     |
| -------------------- | --------------------- | --------------------------------------------------------------- |
| `serverInfo`         | `HttpServerInfo`      | `{ name: string; version: string; port: number }`               |
| `observer`           | `McpServerObserver?`  | Optional observer notified about tool calls and resource reads  |
| `sessionToolFactory` | `SessionToolFactory?` | Optional factory producing session-scoped tool sets (see below) |

When a `sessionToolFactory` is provided, every new HTTP session gets its own
`SessionToolSet` from the factory in addition to the shared tool inventory.
This lets each session carry independent state (e.g. a dedicated workspace
root) without sharing mutable data across concurrent clients. The tool set's
`dispose()` hook is awaited when the session ends (DELETE or `stop()`), so
session-scoped resources are released reliably. Dispose errors are swallowed
so teardown never blocks.

## `start()`

Binds Express to the configured port. Idempotent: subsequent calls are no-ops
while the server is already listening.

## `stop()`

Closes all active HTTP sessions (each transport is closed), clears the session
map, then stops the Express listener and destroys all remaining connections,
including idle keep-alive and open SSE sockets, so the process can shut down
and the port is fully released. Idempotent; safe to call when not running.

## Request routing (`/mcp`)

| Method | Session ID header | Action                                                         |
| ------ | ----------------- | -------------------------------------------------------------- |
| DELETE | present           | [Disconnect that session]                                      |
| DELETE | missing           | 404                                                            |
| POST   | present           | Route to existing session                                      |
| POST   | missing           | Initialize a new session, or answer a `server/discover` probe  |
| GET    | present           | Route to existing session                                      |
| GET    | missing           | 400                                                            |
| Other  | missing           | 400                                                            |
| Other  | present           | Route to existing session; the SDK rejects unsupported methods |

[Disconnect that session]: #lifecycle

A session-less `POST` whose JSON-RPC method is `server/discover` is answered
with HTTP 200 + JSON-RPC `-32601` (Method not found) **without creating a
session**. Modern clients probe with this method before the legacy initialize
handshake; answering `-32601` lets them fall back cleanly instead of getting a
hard connect failure and wasting a session. All other session-less POSTs are
replayed byte-identically into the initialize path, so existing behaviour is
unchanged.

## Lifecycle

1. `constructor(info, observer?, sessionToolFactory?)`: initialises Express app
   and wires routes
2. `registerTool(item)`: tools must be registered **before** `start()` (they are
   copied into each per-session `McpServer` at creation time)
3. `start()`: begins listening on the configured port
4. Client sends `POST /mcp` (initialize) → `handleCreateSession` creates a
   transport, connects a fresh `McpServer` (via `createFreshMcpServer()`),
   registers the shared tools plus (when configured) the session tool set from
   the factory, stores the session, forwards the response
5. Subsequent requests include `Mcp-Session-Id` → routed via
   `handleExistingSession`
6. `DELETE /mcp` → `handleDelete` removes the session, disposes the session
   tool set (if any), then closes the session
7. `stop()` → [`onStop()`](base.md#onstop-protected) snapshots and clears all
   sessions, disposes each session tool set, closes each transport, then stops
   Express and destroys any lingering keep-alive/SSE connections

## Lifecycle hooks

`HttpMcpServer` overrides [`hook()`](base.md#hook) to return an
`HttpServerHookBuilder`, adding the HTTP session events on top of the base
events:

| Event             | Fires when                                                  |
| ----------------- | ----------------------------------------------------------- |
| `sessionCreated`  | an initial `POST /mcp` yields a session id                  |
| `sessionDisposed` | a session is torn down via `DELETE /mcp` or during `stop()` |

See [Hooks](../hooks.md) for usage.

## Types

### `HttpServerInfo`

Extends [`ServerInfo`](base.md#serverinfo) with the TCP port for Express to
bind to.

| Field     | Type     | Description                     |
| --------- | -------- | ------------------------------- |
| `name`    | `string` | Server name                     |
| `version` | `string` | Server version                  |
| `port`    | `number` | TCP port for Express to bind to |

### `SessionToolFactory` & `SessionToolSet`

Defined in [`src/mcp/session-tools.ts`](../../src/mcp/session-tools.ts).

| Type                 | Shape                                                          |
| -------------------- | -------------------------------------------------------------- |
| `SessionToolSet`     | `{ tools: (Tool \| ToolPackage)[]; dispose(): Promise<void> }` |
| `SessionToolFactory` | `{ create(): SessionToolSet }`                                 |

- `SessionToolSet.tools`: the tool instances (or packages) registered for one
  session, in addition to the server's shared inventory.
- `SessionToolSet.dispose()`: called exactly once when the session is torn
  down; should release any session-scoped resources. Must not throw (errors
  are caught and logged by the server).
- `SessionToolFactory.create()`: invoked once per new session to produce a
  fresh, independent tool set.

---

See also: [`BaseMcpServer`](base.md), [`StdioMcpServer`](stdio.md),
[Architecture](../architecture.md#httpmcpserver),
[Quickstart](../quickstart.md#http-server-streamable-http)
