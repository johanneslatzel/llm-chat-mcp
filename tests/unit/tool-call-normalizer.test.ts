import { describe, it, expect } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { AliasTool } from '../helper/test-tools.js';
import { normalizeToolCallArguments } from '../../src/lib/tool-call-normalizer.js';

/** Build a message fixture, including malformed values the SDK types do not model. */
function fixture(value: unknown): JSONRPCMessage {
    return value as JSONRPCMessage;
}

describe('normalizeToolCallArguments', () => {
    const tools = new Map([['alias-tool', new AliasTool()]]);

    it('normalizes an alias in a tools/call request', () => {
        const params: Record<string, unknown> = {
            name: 'alias-tool',
            arguments: { path: 'a.txt' }
        };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toEqual({ paths: ['a.txt'] });
    });

    it('lets the canonical name win over an alias', () => {
        const params: Record<string, unknown> = {
            name: 'alias-tool',
            arguments: { paths: ['a.txt'], path: 'b.txt' }
        };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toEqual({ paths: ['a.txt'] });
    });

    it('leaves non-request messages untouched', () => {
        expect(() =>
            normalizeToolCallArguments(fixture({ jsonrpc: '2.0', id: 1, result: {} }), tools)
        ).not.toThrow();
    });

    it('leaves requests for other methods untouched', () => {
        const params: Record<string, unknown> = { path: 'a.txt' };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'ping', params }),
            tools
        );
        expect(params).toEqual({ path: 'a.txt' });
    });

    it('leaves notifications untouched', () => {
        const params: Record<string, unknown> = {
            name: 'alias-tool',
            arguments: { path: 'a.txt' }
        };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toEqual({ path: 'a.txt' });
    });

    it('leaves requests without params untouched', () => {
        expect(() =>
            normalizeToolCallArguments(
                fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
                tools
            )
        ).not.toThrow();
    });

    it('leaves a non-string tool name untouched', () => {
        const params: Record<string, unknown> = { name: 42, arguments: { path: 'a.txt' } };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toEqual({ path: 'a.txt' });
    });

    it('leaves missing arguments untouched', () => {
        const params: Record<string, unknown> = { name: 'alias-tool' };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params).toEqual({ name: 'alias-tool' });
    });

    it('leaves null arguments untouched', () => {
        const params: Record<string, unknown> = { name: 'alias-tool', arguments: null };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toBeNull();
    });

    it('leaves non-object arguments untouched', () => {
        const params: Record<string, unknown> = { name: 'alias-tool', arguments: 'nope' };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toBe('nope');
    });

    it('leaves array arguments untouched', () => {
        const params: Record<string, unknown> = { name: 'alias-tool', arguments: ['nope'] };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toEqual(['nope']);
    });

    it('leaves calls to unknown tools untouched', () => {
        const params: Record<string, unknown> = {
            name: 'missing',
            arguments: { path: 'a.txt' }
        };
        normalizeToolCallArguments(
            fixture({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
            tools
        );
        expect(params.arguments).toEqual({ path: 'a.txt' });
    });
});
