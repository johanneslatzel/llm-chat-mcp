# Overview

MCP server library for the `@johannes.latzel/llm-chat` ecosystem. Wraps `Tool`
and `ToolPackage` instances behind the [Model Context Protocol][mcp] so they can
be served over stdio or HTTP.

## Navigation

- [Quick Start](quickstart.md): run a stdio or HTTP server
- [Architecture](architecture.md): design and internals
- [Document Resources](resources.md): expose documents as MCP resources
- [Servers](servers/index.md): `BaseMcpServer`, `StdioMcpServer`, `HttpMcpServer`
- [Converters](converters/index.md): schema and result conversion

## License

MIT. See [`LICENSE`](https://github.com/johanneslatzel/llm-chat-mcp/blob/main/LICENSE).

[mcp]: https://modelcontextprotocol.io
