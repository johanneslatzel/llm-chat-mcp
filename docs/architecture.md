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
  ├── StdioMcpServer: stdin/stdout transport
  └── HttpMcpServer: Streamable HTTP transport (Express)
```

### [`BaseMcpServer`](servers/base.md)

- Stores the `serverInfo` metadata and a `ToolRegistry` inventory of registered
  tools plus their enable/disable state
- [`registerTool(item)`](servers/base.md#registertoolitem) stores the item and
  registers its tools on the SDK's `McpServer`
- [`setDisabledTools(names)`](servers/base.md#setdisabledtoolsnames) replaces
  the disabled-tool set; an empty list re-enables every tool.
  [`disableTool(name)`](servers/base.md#disabletoolname) and
  [`enableTool(name)`](servers/base.md#enabletoolname) toggle single tools
- [`registerDocument`](servers/base.md#registerdocumentpathorconfig) registers a single file
  as a static MCP resource; [`registerFolder`](servers/base.md#registerfolderpathorconfig)
  registers every matching file in a folder (recursively) as static resources.
  See [Document Resources](resources.md)
- [`createFreshMcpServer()`](servers/base.md#createfreshmcpserver-protected)
  creates a brand-new `McpServer` with all previously registered tools and
  documents replayed, used by `HttpMcpServer` to give each HTTP session its own
  isolated server instance
- [`stop()`](servers/base.md#stop) calls the `onStop()` lifecycle hook then
  closes the server
- Subclasses implement `start()` to connect their transport

### [`StdioMcpServer`](servers/stdio.md)

- [`start()`](servers/stdio.md#start) creates a `StdioServerTransport` and
  connects
- Suitable for MCP clients that spawn a child process (e.g. VS Code, Claude Desktop)

### [`HttpMcpServer`](servers/http.md)

- Express-based server listening on a configurable port
- Provides a single route `POST /mcp` (Streamable HTTP)
- **Multi-session architecture**: each HTTP client gets its own
  `(StreamableHTTPServerTransport, McpServer)` pair, keyed by the
  `Mcp-Session-Id` header
- Session map access is protected by an `async-mutex` `Mutex` to prevent
  concurrent modification from overlapping requests (see
  [`HttpMcpServer`](servers/http.md) for the full reference)

#### Request routing (`/mcp`)

| Method | Session ID header | Action                    |
| ------ | ----------------- | ------------------------- |
| DELETE | present           | Disconnect that session   |
| DELETE | missing           | 404                       |
| POST   | present           | Route to existing session |
| POST   | missing           | Create a new session      |
| GET    | present           | Route to existing session |
| GET    | missing           | 400                       |
| Other  | missing           | 400                       |
| Other  | present           | Route to existing session; the SDK rejects unsupported methods |

#### Lifecycle

1. `constructor(info)`: initialises Express app and wires routes
2. `registerTool(item)`: tools must be registered **before** `start()` (they are
   copied into each per-session `McpServer` at creation time)
3. `start()`: begins listening on the configured port
4. Client sends `POST /mcp` (initialize) → `handleCreateSession` creates a
   transport, connects a fresh `McpServer`, stores the session, forwards the
   response
5. Subsequent requests include `Mcp-Session-Id` → routed via
   `handleExistingSession`
6. `DELETE /mcp` → `handleDelete` removes and closes the session
7. `stop()` → `onStop()` snapshots and clears all sessions, closes each
   transport, then stops Express

## Tool model and per-server views

`BaseMcpServer` keeps the tool inventory in a `ToolRegistry`, the model. It
holds every registered llm-chat `Tool` plus the disabled-tool policy and is the
single source of truth shared by the base server and every HTTP session. The
registry deliberately owns no handles.

SDK servers are the views: the base `McpServer` and each per-session
`McpServer` each own their own `RegisteredTool` handle set, created by
materializing the model's tools onto them. `registerTool()` registers onto the
base server and mirrors its handles; `setDisabledTools()` pushes the policy
onto the base server's handles and every active session's; new sessions replay
the model via `createFreshMcpServer()`. The SDK keeps its own private copy of
each server's handles, so `BaseMcpServer` shadows the base server's only to
push enable/disable state onto it.

## Internal converters

### [`toolSchemaToZod`](converters/schema-converter.md) (schema-converter.ts)

Converts the JSON Schema output from `Tool.toOpenAI().function.parameters` into
a Zod object schema. Supports: `string`, `number`, `integer`, `boolean`,
`array` (with nested items), `object` (with nested properties). Recursively
handles required/optional fields and `description` annotations.
See [`src/lib/schema-converter.ts`](../src/lib/schema-converter.ts).

### [`toolResultsToMcp`](converters/result-converter.md) (result-converter.ts)

Converts an array of llm-chat `ToolResult` into the MCP `CallToolResult` shape.
Maps each result to a `{ type: "text", text: string }` content entry. Sets
`isError: true` when any result has a non-success status.
See [`src/lib/result-converter.ts`](../src/lib/result-converter.ts).

## Document resources

### [`registerFileResourceOnServer`](resources.md) (document-resource.ts)

Registers a single file as a static MCP resource at a `file://` URI. The file is
read lazily on `resources/read`, served as text or base64 blob depending on the
MIME type inferred from the file extension.

### [`registerFolderResourcesOnServer`](resources.md) (document-resource.ts)

Recursively collects every file in a folder matching the configured extensions
(default: all supported MIME types) and registers each as a static resource
named by its path relative to the folder root. A folder with no matches
registers nothing.

See [`src/mcp/document-resource.ts`](../src/mcp/document-resource.ts).

## Public API surface

All public exports come from `src/index.ts`; the `lib/` converters and the
`McpSession` and `DocumentEntry` types are internal. `FileDocumentConfig` and
`FolderDocumentConfig` are exported for typed registration.

## Dependencies

| Package                     | Role                         |
| --------------------------- | ---------------------------- |
| `@johannes.latzel/llm-chat` | Tool / ToolPackage framework |
| `@modelcontextprotocol/sdk` | MCP protocol, transports     |
| `express`                   | HTTP server                  |
| `async-mutex`               | Session map synchronisation  |
| `zod`                       | Runtime schema validation    |

---

See also: [Servers](servers/index.md), [Converters](converters/index.md),
[Document Resources](resources.md), [Quick Start](quickstart.md)

[mcp]: https://modelcontextprotocol.io
