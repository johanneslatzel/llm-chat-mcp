# `StdioMcpServer`

MCP server over standard input/output. Extends [`BaseMcpServer`](base.md).
See [`src/mcp/mcp-server.ts`](../../src/mcp/mcp-server.ts) for the full
signature.

## `start()`

Creates a `StdioServerTransport` and connects. Reads JSON-RPC messages from
stdin and writes responses to stdout.

Suitable for MCP clients that spawn a child process (e.g. VS Code,
Claude Desktop).

---

See also: [`BaseMcpServer`](base.md), [`HttpMcpServer`](http.md),
[Quick Start](../quickstart.md)
