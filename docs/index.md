# llm-chat-mcp

MCP server library for the `@johannes.latzel/llm-chat` ecosystem. Wraps `Tool`
and `ToolPackage` instances behind the [Model Context Protocol][mcp] so they can
be served over stdio or HTTP.

## Navigation

- [Quick Start](quickstart.md) — get a server running in minutes
- [Architecture](architecture.md) — design and internals
- [Servers](servers/index.md) — `BaseMcpServer`, `StdioMcpServer`, `HttpMcpServer`
- [Converters](converters/index.md) — schema and result conversion

[mcp]: https://modelcontextprotocol.io
