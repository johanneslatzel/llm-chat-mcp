# Converters

Internal modules that bridge llm-chat types with MCP protocol types:

- [`toolSchemaToZod`](schema-converter.md): JSON Schema → Zod schema
- [`toolResultsToMcp`](result-converter.md): `ToolResult[]` → MCP `CallToolResult`

Both are used by [`BaseMcpServer.registerTool()`](../servers/base.md#registertoolitem) to
transform tools at registration time.

See also: [Architecture](../architecture.md#internal-converters),
[Servers](../servers/index.md)
