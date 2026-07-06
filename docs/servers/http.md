# `HttpMcpServer`

MCP server over Streamable HTTP using Express. Each HTTP client gets its own
session. Extends [`BaseMcpServer`](base.md). See
[`src/mcp/mcp-server.ts`](../../src/mcp/mcp-server.ts) for the full signature.

## `constructor(serverInfo)`

| Parameter    | Type             | Description                                       |
| ------------ | ---------------- | ------------------------------------------------- |
| `serverInfo` | `HttpServerInfo` | `{ name: string; version: string; port: number }` |

## `start()`

Binds Express to the configured port. Idempotent — subsequent calls are no-ops
while the server is already listening.

## `stop()`

Closes all active HTTP sessions (each transport is closed), clears the session
map, then stops the Express listener.

## Request routing (`/mcp`)

| Method | Session ID header | Action                    |
| ------ | ----------------- | ------------------------- |
| DELETE | present           | [Disconnect that session] |
| DELETE | missing           | 404                       |
| POST   | present           | Route to existing session |
| POST   | missing           | [Create a new session]    |
| GET    | present           | Route to existing session |
| GET    | missing           | 400                       |
| Other  | —                 | 400                       |

[Disconnect that session]: #lifecycle
[Create a new session]: #lifecycle

## Lifecycle

1. `constructor(info)` — initialises Express app and wires routes
2. `register(item)` — tools must be registered **before** `start()` (they are
   copied into each per-session `McpServer` at creation time)
3. `start()` — begins listening on the configured port
4. Client sends `POST /mcp` (initialize) → `handleCreateSession` creates a
   transport, connects a fresh `McpServer` (via
   [`createFreshMcpServer()`](base.md#createfreshmcpserver-protected)), stores
   the session, forwards the response
5. Subsequent requests include `Mcp-Session-Id` → routed via
   `handleExistingSession`
6. `DELETE /mcp` → `handleDelete` removes and closes the session
7. `stop()` → [`onStop()`](base.md#onstop-protected) snapshots and clears all
   sessions, closes each transport, then stops Express

## Types

### `HttpServerInfo`

Extends [`ServerInfo`](base.md#serverinfo) with the TCP port for Express to
bind to.

| Field     | Type     | Description                     |
| --------- | -------- | ------------------------------- |
| `name`    | `string` | Server name                     |
| `version` | `string` | Server version                  |
| `port`    | `number` | TCP port for Express to bind to |

---

See also: [`BaseMcpServer`](base.md), [`StdioMcpServer`](stdio.md),
[Architecture](../architecture.md#httpmcpserver), [Quick Start](../quickstart.md#http-server-streamable-http)
