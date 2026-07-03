# Architecture

## Overview

`@johannes.latzel/llm-chat-mcp` bridges the `@johannes.latzel/llm-chat` tool
ecosystem with the [Model Context Protocol][mcp]. It takes `Tool` and
`ToolPackage` instances, converts their JSON Schema parameter definitions to
Zod schemas for validation, and exposes them over stdio or HTTP through the MCP
SDK.

## Class hierarchy

```
BaseMcpServer  (abstract)
  ├── StdioMcpServer   — stdin/stdout transport
  └── HttpMcpServer    — Streamable HTTP transport (Express)
```

### BaseMcpServer

- Stores the `serverInfo` metadata and a list of registered items
- `register(item)` stores the item and registers its tools on the SDK's `McpServer`
- `createFreshMcpServer()` creates a brand-new `McpServer` with all previously
  registered tools replayed — used by `HttpMcpServer` to give each HTTP session
  its own isolated server instance
- `stop()` calls the `onStop()` lifecycle hook then closes the server
- Subclasses implement `start()` to connect their transport

### StdioMcpServer

- `start()` creates a `StdioServerTransport` and connects
- Suitable for MCP clients that spawn a child process (e.g. VS Code, Claude Desktop)

### HttpMcpServer

- Express-based server listening on a configurable port
- Provides a single route `POST /mcp` (Streamable HTTP)
- **Multi-session architecture**: each HTTP client gets its own
  `(StreamableHTTPServerTransport, McpServer)` pair, keyed by the
  `Mcp-Session-Id` header
- Session map access is protected by an `async-mutex` `Mutex` to prevent
  concurrent modification from overlapping requests

#### Request routing (`/mcp`)

| Method | Session ID header | Action                    |
| ------ | ----------------- | ------------------------- |
| DELETE | present           | Disconnect that session   |
| DELETE | missing           | 404                       |
| POST   | present           | Route to existing session |
| POST   | missing           | Create a new session      |
| GET    | present           | Route to existing session |
| GET    | missing           | 400                       |
| Other  | —                 | 400                       |

#### Lifecycle

1. `constructor(info)` — initialises Express app and wires routes
2. `register(item)` — tools must be registered **before** `start()` (they are
   copied into each per-session `McpServer` at creation time)
3. `start()` — begins listening on the configured port
4. Client sends `POST /mcp` (initialize) → `handleCreateSession` creates a
   transport, connects a fresh `McpServer`, stores the session, forwards the
   response
5. Subsequent requests include `Mcp-Session-Id` → routed via
   `handleExistingSession`
6. `DELETE /mcp` → `handleDelete` removes and closes the session
7. `stop()` → `onStop()` snapshots and clears all sessions, closes each
   transport, then stops Express

## Internal converters

### `toolSchemaToZod` (schema-converter.ts)

Converts the JSON Schema output from `Tool.toOpenAI().function.parameters` into
a Zod object schema. Supports: `string`, `number`, `integer`, `boolean`,
`array` (with nested items), `object` (with nested properties). Recursively
handles required/optional fields and `description` annotations.

### `toolResultsToMcp` (result-converter.ts)

Converts an array of llm-chat `ToolResult` into the MCP `CallToolResult` shape.
Maps each result to a `{ type: "text", text: string }` content entry. Sets
`isError: true` when any result has a non-success status.

## Public API surface

All public exports come from `src/index.ts` — the `lib/` converters and the
`McpSession` type are internal.

## Dependencies

| Package                     | Role                         |
| --------------------------- | ---------------------------- |
| `@johannes.latzel/llm-chat` | Tool / ToolPackage framework |
| `@modelcontextprotocol/sdk` | MCP protocol, transports     |
| `express`                   | HTTP server                  |
| `async-mutex`               | Session map synchronisation  |
| `zod`                       | Runtime schema validation    |

[mcp]: https://modelcontextprotocol.io
