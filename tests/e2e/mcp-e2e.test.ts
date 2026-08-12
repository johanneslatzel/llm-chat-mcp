import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { HttpMcpServer } from '../index.js';
import { GreetTool } from '../index.js';
import { ErrorTool } from '../index.js';
import { NoParamTool } from '../index.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('MCP end-to-end', () => {
    it('lists tools and calls greet via stdio', async () => {
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['tsx', 'tests/helper/stdio-run.ts']
        });
        const client = new Client({ name: 'e2e-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const toolsResult = await client.listTools();
        expect(toolsResult.tools).toHaveLength(1);
        expect(toolsResult.tools[0]?.name).toBe('greet');
        expect(toolsResult.tools[0]?.description).toContain('name');

        const callResult = (await client.callTool({
            name: 'greet',
            arguments: { name: 'World' }
        })) as {
            isError?: boolean;
            content: Array<{ text?: string }>;
        };
        expect(callResult.isError).toBeFalsy();
        expect(callResult.content[0]?.text).toBe('Hello, World!');

        await client.close();
    });

    it('calls a tool returning error via stdio', async () => {
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['tsx', 'tests/helper/stdio-run-error.ts']
        });
        const client = new Client({ name: 'e2e-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const toolsResult = await client.listTools();
        expect(toolsResult.tools).toHaveLength(1);
        expect(toolsResult.tools[0]?.name).toBe('error-tool');

        const callResult = (await client.callTool({
            name: 'error-tool',
            arguments: { name: 'test' }
        })) as {
            isError?: boolean;
            content: Array<{ text?: string }>;
        };
        expect(callResult.isError).toBe(true);
        expect(callResult.content[0]?.text).toBe('Something went wrong');

        await client.close();
    });

    it('lists and calls multiple tools via stdio', async () => {
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['tsx', 'tests/helper/stdio-run-package.ts']
        });
        const client = new Client({ name: 'e2e-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const toolsResult = await client.listTools();
        expect(toolsResult.tools).toHaveLength(2);
        const names = toolsResult.tools.map((t) => t.name).sort();
        expect(names).toEqual(['greet', 'no-param']);

        // Call greet
        const greetResult = (await client.callTool({
            name: 'greet',
            arguments: { name: 'E2E' }
        })) as { content: Array<{ text?: string }> };
        expect(greetResult.content[0]?.text).toBe('Hello, E2E!');

        // Call no-param
        const noParamResult = (await client.callTool({
            name: 'no-param',
            arguments: {}
        })) as { content: Array<{ text?: string }> };
        expect(noParamResult.content[0]?.text).toBe('done');

        await client.close();
    });

    it('calls a tool with no parameters via stdio', async () => {
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['tsx', 'tests/helper/stdio-run-no-params.ts']
        });
        const client = new Client({ name: 'e2e-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const toolsResult = await client.listTools();
        expect(toolsResult.tools).toHaveLength(1);
        expect(toolsResult.tools[0]?.name).toBe('no-param');

        const callResult = (await client.callTool({
            name: 'no-param',
            arguments: {}
        })) as { content: Array<{ text?: string }> };
        expect(callResult.content[0]?.text).toBe('done');

        await client.close();
    });

    it('lists tools and calls greet via HTTP', async () => {
        const server = new HttpMcpServer({
            name: 'e2e-http',
            version: '1.0.0',
            port: 0
        });
        server.registerTool(new GreetTool());
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${port}/mcp`)
        );
        const client = new Client({ name: 'e2e-http-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const toolsResult = await client.listTools();
        expect(toolsResult.tools).toHaveLength(1);
        expect(toolsResult.tools[0]?.name).toBe('greet');

        const callResult = (await client.callTool({
            name: 'greet',
            arguments: { name: 'HTTP' }
        })) as {
            isError?: boolean;
            content: Array<{ text?: string }>;
        };
        expect(callResult.isError).toBeFalsy();
        expect(callResult.content[0]?.text).toBe('Hello, HTTP!');

        await client.close();
        await server.stop();
    });

    it('handles multiple tools via HTTP', async () => {
        const server = new HttpMcpServer({
            name: 'e2e-http-multi',
            version: '1.0.0',
            port: 0
        });
        server.registerTool(new GreetTool());
        server.registerTool(new ErrorTool());
        server.registerTool(new NoParamTool());
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${port}/mcp`)
        );
        const client = new Client({ name: 'e2e-http-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const toolsResult = await client.listTools();
        expect(toolsResult.tools).toHaveLength(3);
        const names = toolsResult.tools.map((t) => t.name).sort();
        expect(names).toEqual(['error-tool', 'greet', 'no-param']);

        const callResult = (await client.callTool({
            name: 'error-tool',
            arguments: { name: 'x' }
        })) as { isError?: boolean; content: Array<{ text?: string }> };
        expect(callResult.isError).toBe(true);
        expect(callResult.content[0]?.text).toBe('Something went wrong');

        await client.close();
        await server.stop();
    });

    it('lists and reads document resources via stdio', async () => {
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['tsx', 'tests/helper/stdio-run-doc.ts']
        });
        const client = new Client({ name: 'e2e-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const resourcesResult = await client.listResources();
        const uris = resourcesResult.resources.map((r) => r.uri).sort();
        expect(uris).toEqual(
            [
                pathToFileURL(path.resolve('tests/helper/docs/notes.md')).toString(),
                pathToFileURL(path.resolve('tests/helper/docs/sub/guide.md')).toString(),
                pathToFileURL(path.resolve('tests/helper/docs/ignore.txt')).toString()
            ].sort()
        );

        const notesUri = uris.find((u) => u.endsWith('/notes.md'))!;
        const readResult = (await client.readResource({ uri: notesUri })) as {
            contents: Array<{ text?: string; mimeType?: string }>;
        };
        expect(readResult.contents[0]?.mimeType).toBe('text/markdown');
        expect(readResult.contents[0]?.text).toContain('# Notes');

        const templatesResult = await client.listResourceTemplates();
        expect(templatesResult.resourceTemplates).toEqual([]);

        await client.close();
    });

    it('lists and reads document resources via HTTP', async () => {
        const server = new HttpMcpServer({
            name: 'e2e-http-doc',
            version: '1.0.0',
            port: 0
        });
        server.registerFolder(path.resolve('tests/helper/docs'));
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${port}/mcp`)
        );
        const client = new Client({ name: 'e2e-http-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const resourcesResult = await client.listResources();
        const uris = resourcesResult.resources.map((r) => r.uri).sort();
        expect(uris).toEqual(
            [
                pathToFileURL(path.resolve('tests/helper/docs/notes.md')).toString(),
                pathToFileURL(path.resolve('tests/helper/docs/sub/guide.md')).toString(),
                pathToFileURL(path.resolve('tests/helper/docs/ignore.txt')).toString()
            ].sort()
        );

        const guideUri = uris.find((u) => u.endsWith('/sub/guide.md'))!;
        const readResult = (await client.readResource({ uri: guideUri })) as {
            contents: Array<{ text?: string }>;
        };
        expect(readResult.contents[0]?.text).toContain('# Guide');

        await client.close();
        await server.stop();
    });

    it('forwards tool calls to an observer via HTTP', async () => {
        const onToolCall = vi.fn();
        const server = new HttpMcpServer(
            { name: 'e2e-http-observer', version: '1.0.0', port: 0 },
            { onToolCall, onResourceRead: vi.fn() }
        );
        server.registerTool(new GreetTool());
        await server.start();
        const address = (server as any).expressServer.address();
        const port: number = address.port;

        const transport = new StreamableHTTPClientTransport(
            new URL(`http://localhost:${port}/mcp`)
        );
        const client = new Client({ name: 'e2e-http-observer-client', version: '1.0.0' });
        await client.connect(transport as Transport);

        const callResult = (await client.callTool({
            name: 'greet',
            arguments: { name: 'Observer' }
        })) as { isError?: boolean; content: Array<{ text?: string }> };
        expect(callResult.content[0]?.text).toBe('Hello, Observer!');

        expect(onToolCall).toHaveBeenCalledTimes(1);
        const info = onToolCall.mock.calls[0]![0];
        expect(info.name).toBe('greet');
        expect(info.error).toBeUndefined();
        expect(info.durationMs).toBeGreaterThanOrEqual(0);

        await client.close();
        await server.stop();
    });


});
