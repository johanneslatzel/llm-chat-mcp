import { describe, it, expect } from 'vitest';
import { toolSchemaToZod } from '../../src/lib/schema-converter.js';

function createMockTool(params: Record<string, unknown> | null): {
    toOpenAI(): { function: { parameters?: Record<string, unknown> | null } };
} {
    return {
        toOpenAI() {
            return {
                function: { parameters: params }
            };
        }
    };
}

describe('toolSchemaToZod', () => {
    it('converts string property', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The name' }
            },
            required: ['name']
        });
        const schema = toolSchemaToZod(tool);
        expect(schema.shape.name).toBeDefined();
        const result = schema.safeParse({ name: 'Alice' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe('Alice');
        }
    });

    it('marks optional properties as optional', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The name' }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        const result = schema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('rejects missing required property', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The name' }
            },
            required: ['name']
        });
        const schema = toolSchemaToZod(tool);
        const result = schema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('converts number property', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                count: { type: 'number', description: 'The count' }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        const result = schema.safeParse({ count: 42 });
        expect(result.success).toBe(true);
    });

    it('converts integer property', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                age: { type: 'integer', description: 'The age' }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        expect(schema.safeParse({ age: 25 }).success).toBe(true);
        expect(schema.safeParse({ age: 25.5 }).success).toBe(false);
    });

    it('converts boolean property', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                active: { type: 'boolean', description: 'Is active' }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        expect(schema.safeParse({ active: true }).success).toBe(true);
    });

    it('converts array property without items', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                tags: { type: 'array', description: 'Tags' }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        expect(schema.safeParse({ tags: ['a', 'b'] }).success).toBe(true);
    });

    it('converts array property with items', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                scores: {
                    type: 'array',
                    description: 'Scores',
                    items: { type: 'number' }
                }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        expect(schema.safeParse({ scores: [1, 2] }).success).toBe(true);
        expect(schema.safeParse({ scores: ['a'] }).success).toBe(false);
    });

    it('converts object property', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                filter: {
                    type: 'object',
                    description: 'Search filter',
                    properties: {
                        field: { type: 'string', description: 'Field name' },
                        value: { type: 'string', description: 'Value' }
                    },
                    required: ['field']
                }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        const result = schema.safeParse({ filter: { field: 'name', value: 'test' } });
        expect(result.success).toBe(true);
    });

    it('handles empty properties', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {},
            required: []
        });
        const schema = toolSchemaToZod(tool);
        expect(schema.safeParse({}).success).toBe(true);
    });

    it('throws on unknown property type', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                data: { type: 'unknown_type', description: 'Some data' }
            },
            required: []
        });
        expect(() => toolSchemaToZod(tool)).toThrow('Unsupported JSON Schema type: unknown_type');
    });

    it('handles null parameters', () => {
        const tool = createMockTool(null);
        const schema = toolSchemaToZod(tool);
        expect(schema.safeParse({}).success).toBe(true);
    });

    it('handles parameters without properties or required', () => {
        const tool = createMockTool({ type: 'object' });
        const schema = toolSchemaToZod(tool);
        expect(schema.safeParse({}).success).toBe(true);
    });

    it('handles nested object without properties or required', () => {
        const tool = createMockTool({
            type: 'object',
            properties: {
                nested: { type: 'object', description: 'Nested without props' }
            },
            required: []
        });
        const schema = toolSchemaToZod(tool);
        const result = schema.safeParse({ nested: {} });
        expect(result.success).toBe(true);
    });
});
