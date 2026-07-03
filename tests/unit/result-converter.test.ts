import { describe, it, expect } from 'vitest';
import { ResultStatus } from '@johannes.latzel/llm-chat';
import { toolResultsToMcp } from '../../src/lib/result-converter.js';

describe('toolResultsToMcp', () => {
    it('converts a success result', () => {
        const results = [
            {
                result: 'Hello, Alice!',
                status: ResultStatus.Success,
                tool: 'greet'
            }
        ];
        const mcp = toolResultsToMcp(results);
        expect(mcp.content).toHaveLength(1);
        expect(mcp.content[0]?.text).toBe('Hello, Alice!');
        expect(mcp.isError).toBeUndefined();
    });

    it('sets isError when any result is error', () => {
        const results = [
            {
                result: 'Something went wrong',
                status: ResultStatus.Error,
                tool: 'greet'
            }
        ];
        const mcp = toolResultsToMcp(results);
        expect(mcp.isError).toBe(true);
        expect(mcp.content[0]?.text).toBe('Something went wrong');
    });

    it('handles multiple results', () => {
        const results = [
            { result: 'First result', status: ResultStatus.Success, tool: 'multi' },
            { result: 'Second result', status: ResultStatus.Success, tool: 'multi' }
        ];
        const mcp = toolResultsToMcp(results);
        expect(mcp.content).toHaveLength(2);
        expect(mcp.content[0]?.text).toBe('First result');
        expect(mcp.content[1]?.text).toBe('Second result');
    });

    it('sets isError when mixed results', () => {
        const results = [
            { result: 'Ok', status: ResultStatus.Success, tool: 'multi' },
            { result: 'Failed', status: ResultStatus.Error, tool: 'multi' }
        ];
        const mcp = toolResultsToMcp(results);
        expect(mcp.isError).toBe(true);
    });

    it('handles empty results', () => {
        const results: Array<{ result: string; status: ResultStatus; tool: string }> = [];
        const mcp = toolResultsToMcp(results);
        expect(mcp.content).toHaveLength(0);
        expect(mcp.isError).toBeUndefined();
    });
});
