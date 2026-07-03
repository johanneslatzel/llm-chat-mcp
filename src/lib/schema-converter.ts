import { z } from 'zod';

/** Convert a JSON Schema array property to a Zod array. */
function arrayPropToZod(prop: Record<string, unknown>): z.ZodArray<z.ZodTypeAny> {
    if (prop.items) {
        return z.array(jsonSchemaPropToZod(prop.items as Record<string, unknown>, true));
    }
    return z.array(z.unknown());
}

/** Convert a JSON Schema object property to a Zod object. */
function objectPropToZod(prop: Record<string, unknown>): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const properties = (prop.properties ?? {}) as Record<string, Record<string, unknown>>;
    const requiredFields = (prop.required ?? []) as string[];
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, child] of Object.entries(properties)) {
        shape[key] = jsonSchemaPropToZod(child, requiredFields.includes(key));
    }
    return z.object(shape);
}

/** Map a JSON Schema type string to a Zod type, delegating array/object to dedicated helpers. */
function typeToZod(type: string, prop: Record<string, unknown>): z.ZodTypeAny {
    switch (type) {
        case 'string':
            return z.string();
        case 'number':
            return z.number();
        case 'integer':
            return z.number().int();
        case 'boolean':
            return z.boolean();
        case 'array':
            return arrayPropToZod(prop);
        case 'object':
            return objectPropToZod(prop);
        default:
            throw new Error(`Unsupported JSON Schema type: ${type}`);
    }
}

/** Recursively convert a single JSON Schema property to a Zod type. */
function jsonSchemaPropToZod(prop: Record<string, unknown>, required: boolean): z.ZodTypeAny {
    const type = prop.type as string;
    const description = prop.description as string | undefined;

    let schema = typeToZod(type, prop);

    if (description) {
        schema = schema.describe(description);
    }

    if (!required) {
        schema = schema.optional();
    }

    return schema;
}

/**
 * Convert an llm-chat {@link Tool} (via its `toOpenAI()` output) into a
 * Zod object schema that the MCP SDK can use for input validation.
 */
export function toolSchemaToZod(tool: {
    toOpenAI(): { function: { parameters?: Record<string, unknown> | null } };
}): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const params = tool.toOpenAI().function.parameters ?? {};
    const properties = (params.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (params.required ?? []) as string[];
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(properties)) {
        shape[key] = jsonSchemaPropToZod(prop, required.includes(key));
    }
    return z.object(shape);
}
