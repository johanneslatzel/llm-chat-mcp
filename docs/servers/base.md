# `BaseMcpServer` (abstract)

Abstract base class for an MCP server. Holds registered tools and provides the
lifecycle contract. See [`src/mcp/mcp-server.ts`](../../src/mcp/mcp-server.ts)
for the full signature.

## `constructor(serverInfo)`

Creates the underlying `McpServer` from `@modelcontextprotocol/sdk`.

| Parameter    | Type         | Description                         |
| ------------ | ------------ | ----------------------------------- |
| `serverInfo` | `ServerInfo` | `{ name: string; version: string }` |

## `register(item)`

Registers a `Tool` or all tools in a `ToolPackage`. Duplicate tool **names**
cause an error from the SDK (not silently overwritten). Must be called before
`start()` — tools are snapshotted at session creation time.

| Parameter | Type                  | Description                                 |
| --------- | --------------------- | ------------------------------------------- |
| `item`    | `Tool \| ToolPackage` | Single tool or package of tools to register |

## `start()` (abstract)

Subclasses implement this to connect the server to a transport. See
[`StdioMcpServer.start()`](stdio.md#start) and
[`HttpMcpServer.start()`](http.md#start).

## `stop()`

Calls the `onStop()` lifecycle hook then closes the underlying `McpServer`.

## `onStop()` (protected)

Lifecycle hook called before the MCP server socket closes. Override to clean up
transport resources. [`HttpMcpServer`](http.md) overrides this to close HTTP
sessions.

## `createFreshMcpServer()` (protected)

Creates a brand-new `McpServer` with all previously registered tools replayed.
Used by [`HttpMcpServer`](http.md#lifecycle) to give each HTTP session its own
isolated server instance.

## Types

### `ServerInfo`

Metadata sent to MCP clients during initialization.

| Field     | Type     | Description    |
| --------- | -------- | -------------- |
| `name`    | `string` | Server name    |
| `version` | `string` | Server version |

---

See also: [`StdioMcpServer`](stdio.md), [`HttpMcpServer`](http.md),
[Architecture](../architecture.md), [Converters](../converters/index.md)
