# BaseMcpServer

Abstract base class for an MCP server. Holds registered tools and provides the
lifecycle contract. See [`src/mcp/mcp-server.ts`](../../src/mcp/mcp-server.ts)
for the full signature.

## `constructor(serverInfo)`

Creates the underlying `McpServer` from `@modelcontextprotocol/sdk`.

| Parameter    | Type         | Description                         |
| ------------ | ------------ | ----------------------------------- |
| `serverInfo` | `ServerInfo` | `{ name: string; version: string }` |

## Tool inventory and enable state

`BaseMcpServer` separates the tool **model** from the per-server **views**:

- The **model** is the `ToolRegistry`: every registered llm-chat `Tool` plus
  the set of disabled tools. It is the single source of truth, shared by the
  base server and every HTTP session.
- A **view** is one SDK server's set of `RegisteredTool` handles, the base
  `McpServer` plus one fresh server per HTTP session (see
  [`createFreshMcpServer()`](#createfreshmcpserver-protected)). The registry
  holds no handles itself; it pushes its state onto whichever handle sets it
  is given.

[`registerTool(item)`](#registertoolitem) adds tools to the model and
materializes them on the base server, mirroring its handles;
[`setDisabledTools(names)`](#setdisabledtoolsnames) updates the model's policy
and pushes it onto the base server's handles plus every active session's
handles.

## `registerTool(item)`

Registers a `Tool` or all tools in a `ToolPackage`. Duplicate tool **names**
cause an error from the SDK (not silently overwritten). Must be called before
`start()`: tools are snapshotted at session creation time.

| Parameter | Type                  | Description                                 |
| --------- | --------------------- | ------------------------------------------- |
| `item`    | `Tool \| ToolPackage` | Single tool or package of tools to register |

## `setDisabledTools(names)`

Replaces the set of disabled tools. Because it replaces the whole set, passing
an empty list re-enables every tool. Disabled tools are hidden from
`tools/list` and rejected on `tools/call` on the base server and every active
session; the set also applies to sessions created later. Use this when applying
a persisted disabled set wholesale; for a single runtime toggle use
[`disableTool(name)`](#disabletoolname) or
[`enableTool(name)`](#enabletoolname).

| Parameter | Type       | Description                       |
| --------- | ---------- | --------------------------------- |
| `names`   | `string[]` | Tool names to disable (exact set) |

## `disableTool(name)`

Disables a single tool (adding it to the disabled set) on the base server and
every active session. Does not throw for unknown names. Re-enable with
[`enableTool(name)`](#enabletoolname).

| Parameter | Type     | Description               |
| --------- | -------- | ------------------------- |
| `name`    | `string` | Tool name to disable      |

## `enableTool(name)`

Enables a single tool (removing it from the disabled set) on the base server
and every active session. Does not throw for unknown names.

| Parameter | Type     | Description             |
| --------- | -------- | ----------------------- |
| `name`    | `string` | Tool name to enable     |

## `registerDocument(pathOrConfig)`

Registers a single **file** as a static MCP resource. The content is read lazily
on `resources/read`, so changes on disk are picked up. The resource `name`
defaults to the file's basename. A non-file path throws.

| Parameter      | Type                           | Description                                  |
| -------------- | ------------------------------ | -------------------------------------------- |
| `pathOrConfig` | `string \| FileDocumentConfig` | File path, or config with metadata overrides |

### `FileDocumentConfig`

| Field         | Type     | Description                                        |
| ------------- | -------- | -------------------------------------------------- |
| `path`        | `string` | Path to the file                                   |
| `name`        | `string` | Resource name (default: file basename)             |
| `title`       | `string` | Resource title shown by clients                    |
| `description` | `string` | Resource description shown by clients              |
| `mimeType`    | `string` | Override the MIME type inferred from the extension |

## `registerFolder(pathOrConfig)`

Registers every **matching file** in a folder as a static MCP resource. The scan
is **recursive**; each match is named by its path relative to the folder root
(e.g. `notes.md`, `sub/guide.md`). A folder with no matches registers nothing. A
non-directory path throws.

| Parameter      | Type                             | Description                                    |
| -------------- | -------------------------------- | ---------------------------------------------- |
| `pathOrConfig` | `string \| FolderDocumentConfig` | Folder path, or config with metadata overrides |

### `FolderDocumentConfig`

| Field         | Type       | Description                                                                                                                          |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `path`        | `string`   | Path to the folder                                                                                                                   |
| `title`       | `string`   | Title applied to every resource from this folder                                                                                     |
| `description` | `string`   | Description applied to every resource from this folder                                                                               |
| `mimeType`    | `string`   | MIME type override applied to every resource from this folder                                                                        |
| `extensions`  | `string[]` | Extensions to include, case-insensitive, with or without leading dot (default: all supported types, e.g. `md`, `txt`, `json`, `pdf`) |

Both methods must be called before `start()`, matching `registerTool(item)`.

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

Creates a brand-new `McpServer` with all previously registered tools and
documents replayed. Used by [`HttpMcpServer`](http.md#lifecycle) to give each
HTTP session its own isolated server instance.

## Types

### `ServerInfo`

Metadata sent to MCP clients during initialization.

| Field     | Type     | Description    |
| --------- | -------- | -------------- |
| `name`    | `string` | Server name    |
| `version` | `string` | Server version |

---

See also: [`StdioMcpServer`](stdio.md), [`HttpMcpServer`](http.md),
[Document Resources](../resources.md), [Architecture](../architecture.md),
[Converters](../converters/index.md)
