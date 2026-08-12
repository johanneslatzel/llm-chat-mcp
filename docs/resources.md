# Document Resources

Servers can expose documents as MCP **resources**: read-only content served
over `resources/list` and `resources/read`. Two registration methods cover the
two container shapes:

- [`registerDocument`](servers/base.md#registerdocumentpathorconfig): a single **file**
- [`registerFolder`](servers/base.md#registerfolderpathorconfig): every matching **file**
  in a folder (recursively)

## How it works

| Registration             | Result                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| `registerDocument(file)` | One static resource at `file:///…/file.md`, read lazily on `resources/read`  |
| `registerFolder(dir)`    | Every matching file (default: all supported types) becomes a static resource |

Folder scans are **recursive** and resource `name`s are the file path relative
to the registered folder root (e.g. `notes.md`, `sub/guide.md`). Files are read
lazily on each `resources/read`, so changes on disk are picked up. A folder with
no matching files registers nothing.

Registered files and folders appear in the client's `resources/list` as normal
static resources. No resource templates are used.

## MIME types

The MIME type is inferred from the file extension (`.md` → `text/markdown`,
`.json` → `application/json`, `.pdf` → `application/pdf`, images, and more),
falling back to `application/octet-stream`. Textual MIME types are served as
`text` content; binary types as a base64 `blob`. Both the file and folder
configs accept a `mimeType` override.

By default `registerFolder` picks up every supported extension (`md`,
`markdown`, `txt`, `text`, `json`, `yaml`, `yml`, `csv`, `html`, `htm`, `xml`,
`svg`, `pdf`, `png`, `jpg`, `jpeg`, `gif`, `webp`). Use `extensions` to narrow
the scan.

## Example

```typescript
import { StdioMcpServer } from '@johannes.latzel/llm-chat-mcp';

const server = new StdioMcpServer({ name: 'doc-server', version: '1.0.0' });

server.registerDocument('./README.md');
server.registerFolder('./docs'); // every supported type, recursively
server.registerFolder({ path: './data', extensions: ['md', 'txt'] });

await server.start();
```

Clients then call `client.listResources()` to see every document and
`client.readResource({ uri })` to fetch any of them.

## Constraints

- Registering the **same file twice** (directly or via two overlapping folders)
  throws, since resource URIs must be unique, mirroring duplicate tool names.
- Registering a path that does not exist, or registering a directory via
  `registerDocument` / a file via `registerFolder`, throws at registration time.
- Reading a file that has been deleted after registration throws an MCP error.

---

See also: [`BaseMcpServer`](servers/base.md), [Architecture](architecture.md),
[Quick Start](quickstart.md)
