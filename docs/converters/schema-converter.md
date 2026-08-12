# `toolSchemaToZod`

Converts the JSON Schema output from `Tool.toOpenAI().function.parameters` into
a Zod object schema that the MCP SDK uses for input validation. See
[`src/lib/schema-converter.ts`](../../src/lib/schema-converter.ts) for the full
signature.

Supports:

| JSON Schema type | Zod type           |
| ---------------- | ------------------ |
| `string`         | `z.string()`       |
| `number`         | `z.number()`       |
| `integer`        | `z.number().int()` |
| `boolean`        | `z.boolean()`      |
| `array`          | `z.array(...)`     |
| `object`         | `z.object({...})`  |

Recursively handles required/optional fields and `description` annotations.
Throws on unknown types.

Called by [`BaseMcpServer.registerTool()`](../servers/base.md#registertoolitem) for every
registered tool.

---

See also: [`toolResultsToMcp`](result-converter.md),
[Architecture](../architecture.md#toolschematozod-schema-converterts),
[Servers](../servers/index.md)
