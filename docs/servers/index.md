# Servers

Three server classes, one abstract and two concrete:

- [`BaseMcpServer`](base.md) — abstract base with register/start/stop lifecycle
- [`StdioMcpServer`](stdio.md) — stdin/stdout transport
- [`HttpMcpServer`](http.md) — Streamable HTTP transport (Express, multi-session)

All sources in [`src/mcp/mcp-server.ts`](../../src/mcp/mcp-server.ts).

See also: [Architecture](../architecture.md), [Converters](../converters/index.md)
