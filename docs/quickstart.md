# Quick Start

## Installation

```bash
npm install @johannes.latzel/llm-chat-mcp
```

Requirements: Node.js >= 20, TypeScript >= 5.0 (the package ships `.js` with
type declarations from `dist/`).

## Stdio server (one-liner)

[`StdioMcpServer`](servers/stdio.md): connects via a `StdioServerTransport`:

```typescript
import { StdioMcpServer } from '@johannes.latzel/llm-chat-mcp';

const server = new StdioMcpServer({ name: 'my-server', version: '1.0.0' });
server.registerTool(tool); // Tool or ToolPackage instance
await server.start(); // reads requests on stdin, writes on stdout
```

### Serving documents

Expose files and folders as MCP resources (see [Resources](resources.md)):

```typescript
server.registerDocument('./README.md');
server.registerFolder('./docs'); // every supported type, recursively
await server.start();
```

Clients list them with `resources/list` and read them with `resources/read`.

## HTTP server (Streamable HTTP)

[`HttpMcpServer`](servers/http.md): Express-based, multi-session:

```typescript
import { HttpMcpServer } from '@johannes.latzel/llm-chat-mcp';

const server = new HttpMcpServer({ name: 'my-server', version: '1.0.0', port: 3000 });
server.registerTool(tool); // Tool or ToolPackage instance
server.registerFolder('./docs'); // documents as MCP resources
await server.start(); // binds to http://localhost:3000
```

The `/mcp` endpoint follows the [Streamable HTTP transport spec][streamable-http].
Each HTTP client gets its own session with an isolated transport + `McpServer` pair
(see [session lifecycle](servers/http.md#lifecycle)).

### Client example

```bash
# Initialize
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0"}}}'

# List tools (use Mcp-Session-Id from the initialize response)
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Mcp-Session-Id: <session-id>' \
  -H 'Mcp-Protocol-Version: 2025-03-26' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Disconnect
curl -X DELETE http://localhost:3000/mcp \
  -H 'Mcp-Session-Id: <session-id>'
```

## Graceful shutdown

```typescript
await server.stop();
```

Closes all active HTTP sessions / stdio transport before returning. See
[`BaseMcpServer.stop()`](servers/base.md#stop) for details.

## Next steps

See the [Architecture](architecture.md) for design details and the
[Server reference](servers/index.md) for the full API surface.

[streamable-http]: https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/#streamable-http
