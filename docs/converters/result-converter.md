# `toolResultsToMcp`

Converts an array of llm-chat [`ToolResult`][llm-chat] into the MCP
`CallToolResult` shape. Maps each result to a `{ type: "text", text: string }`
content entry. Sets `isError: true` when any result has a non-success status.
See [`src/lib/result-converter.ts`](../../src/lib/result-converter.ts) for the
full signature.

Called by [`BaseMcpServer.registerTool()`](../servers/base.md#registertoolitem) in the tool
handler closure.

[llm-chat]: https://johanneslatzel.github.io/llm-chat/

---

See also: [`toolSchemaToZod`](schema-converter.md),
[Architecture](../architecture.md#toolresultstomcp-result-converterts),
[Servers](../servers/index.md)
