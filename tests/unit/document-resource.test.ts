import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { HttpMcpServer, StdioMcpServer } from '../index.js';

type Resource = {
    name: string;
    metadata: { mimeType?: string; title?: string; description?: string };
    readCallback: (uri: URL) => Promise<{
        contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
    }>;
};

const DOCS_DIR = path.resolve('tests/helper/docs');
const NOTES = path.join(DOCS_DIR, 'notes.md');

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'llm-chat-mcp-doc-'));
    tempDirs.push(dir);
    return dir;
}

function resourcesOf(server: StdioMcpServer): Record<string, Resource> {
    return (server as any).mcpServer._registeredResources as Record<string, Resource>;
}

afterEach(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
});

describe('registerDocument', () => {
    it('registers a text file as a static resource', async () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerDocument(NOTES);

        const resources = resourcesOf(server);
        const uri = pathToFileURL(NOTES).toString();
        expect(Object.keys(resources)).toEqual([uri]);

        const resource = resources[uri]!;
        expect(resource.name).toBe('notes.md');
        expect(resource.metadata.mimeType).toBe('text/markdown');

        const result = await resource.readCallback(new URL(uri));
        expect(result.contents[0]?.uri).toBe(uri);
        expect(result.contents[0]?.mimeType).toBe('text/markdown');
        expect(result.contents[0]?.text).toContain('# Notes');
        expect(result.contents[0]?.blob).toBeUndefined();
    });

    it('supports name, title, description and mimeType overrides', async () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerDocument({
            path: NOTES,
            name: 'custom-name',
            title: 'Custom Title',
            description: 'A custom description',
            mimeType: 'text/plain'
        });

        const resource = Object.values(resourcesOf(server))[0]!;
        expect(resource.name).toBe('custom-name');
        expect(resource.metadata.title).toBe('Custom Title');
        expect(resource.metadata.description).toBe('A custom description');
        expect(resource.metadata.mimeType).toBe('text/plain');
    });

    it('serves binary files as a base64 blob', async () => {
        const dir = makeTempDir();
        const binPath = path.join(dir, 'image.bin');
        writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0x89, 0x50, 0x4e]));

        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerDocument(binPath);

        const resource = Object.values(resourcesOf(server))[0]!;
        expect(resource.metadata.mimeType).toBe('application/octet-stream');

        const result = await resource.readCallback(new URL(pathToFileURL(binPath).toString()));
        expect(result.contents[0]?.blob).toBe(
            Buffer.from([0x00, 0x01, 0x02, 0x89, 0x50, 0x4e]).toString('base64')
        );
        expect(result.contents[0]?.text).toBeUndefined();
    });

    it('throws when the path does not exist', () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        expect(() => server.registerDocument(path.join(DOCS_DIR, 'missing.md'))).toThrow();
    });

    it('throws when the path is not a file', () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        expect(() => server.registerDocument(DOCS_DIR)).toThrow('not a file');
    });

    it('throws when registering the same file twice', () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerDocument(NOTES);
        expect(() => server.registerDocument(NOTES)).toThrow();
    });

    it('throws an McpError when the file cannot be read', async () => {
        const dir = makeTempDir();
        const filePath = path.join(dir, 'gone.md');
        writeFileSync(filePath, 'content');
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerDocument(filePath);

        rmSync(filePath);

        const resource = Object.values(resourcesOf(server))[0]!;
        await expect(
            resource.readCallback(new URL(pathToFileURL(filePath).toString()))
        ).rejects.toBeInstanceOf(McpError);
    });
});

describe('registerFolder', () => {
    it('recursively registers all supported files with relative names', async () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerFolder(DOCS_DIR);

        const resources = resourcesOf(server);
        expect(Object.keys(resources).sort()).toEqual(
            [
                path.join(DOCS_DIR, 'notes.md'),
                path.join(DOCS_DIR, 'sub', 'guide.md'),
                path.join(DOCS_DIR, 'ignore.txt')
            ]
                .map((p) => pathToFileURL(p).toString())
                .sort()
        );

        const notesUri = pathToFileURL(path.join(DOCS_DIR, 'notes.md')).toString();
        const guideUri = pathToFileURL(path.join(DOCS_DIR, 'sub', 'guide.md')).toString();
        expect(resources[notesUri]!.name).toBe('notes.md');
        expect(resources[guideUri]!.name).toBe('sub/guide.md');
        expect(resources[notesUri]!.metadata.mimeType).toBe('text/markdown');

        const result = await resources[guideUri]!.readCallback(new URL(guideUri));
        expect(result.contents[0]?.text).toContain('# Guide');
    });

    it('filters by configured extensions (case-insensitive, with or without dots)', async () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerFolder({ path: DOCS_DIR, extensions: ['.TXT'] });

        const resources = Object.values(resourcesOf(server));
        expect(resources).toHaveLength(1);
        expect(resources[0]?.name).toBe('ignore.txt');
        expect(resources[0]?.metadata.mimeType).toBe('text/plain');
    });

    it('applies title, description and mimeType to every resource', async () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerFolder({
            path: DOCS_DIR,
            title: 'Docs',
            description: 'All docs',
            mimeType: 'text/plain'
        });

        for (const resource of Object.values(resourcesOf(server))) {
            expect(resource.metadata.title).toBe('Docs');
            expect(resource.metadata.description).toBe('All docs');
            expect(resource.metadata.mimeType).toBe('text/plain');
        }
    });

    it('registers nothing when a folder has no matching files', () => {
        const dir = makeTempDir();
        writeFileSync(path.join(dir, 'readme.bin'), 'no supported file here');

        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerFolder(dir);

        expect(Object.keys(resourcesOf(server))).toEqual([]);
    });

    it('falls back to supported types when extensions is an empty array', () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        server.registerFolder({ path: DOCS_DIR, extensions: [] });

        const names = Object.values(resourcesOf(server))
            .map((r) => r.name)
            .sort();
        expect(names).toEqual(['ignore.txt', 'notes.md', 'sub/guide.md']);
    });

    it('throws when the path is not a directory', () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        expect(() => server.registerFolder(NOTES)).toThrow('not a directory');
    });

    it('throws when the folder path does not exist', () => {
        const server = new StdioMcpServer({ name: 'doc', version: '1.0.0' });
        expect(() => server.registerFolder(path.join(DOCS_DIR, 'nope'))).toThrow();
    });
});

describe('createFreshMcpServer', () => {
    it('replays registered documents into fresh servers', async () => {
        const dir = makeTempDir();
        const standalone = path.join(dir, 'standalone.md');
        writeFileSync(standalone, '# Standalone');

        const server = new HttpMcpServer({ name: 'http-doc', version: '1.0.0', port: 0 });
        server.registerDocument(standalone);
        server.registerFolder(DOCS_DIR);

        const fresh = (server as any).createFreshMcpServer() as {
            mcpServer: { _registeredResources: Record<string, Resource> };
        };
        const names = Object.values(fresh.mcpServer._registeredResources)
            .map((r) => r.name)
            .sort();
        expect(names).toEqual(['ignore.txt', 'notes.md', 'standalone.md', 'sub/guide.md']);
    });
});


describe('McpServerObserver resource reads', () => {
    it('reports successful resource reads', async () => {
        const onResourceRead = vi.fn();
        const server = new StdioMcpServer(
            { name: 'doc', version: '1.0.0' },
            { onToolCall: vi.fn(), onResourceRead }
        );
        server.registerDocument(NOTES);
        const resource = Object.values(resourcesOf(server))[0]!;
        const result = await resource.readCallback(new URL(pathToFileURL(NOTES).toString()));
        expect(result.contents[0]?.text).toContain('# Notes');
        expect(onResourceRead).toHaveBeenCalledTimes(1);
        const info = onResourceRead.mock.calls[0]![0];
        expect(info.uri).toBe(pathToFileURL(NOTES).toString());
        expect(info.ok).toBe(true);
        expect(info.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('reports failed resource reads', async () => {
        const onResourceRead = vi.fn();
        const server = new StdioMcpServer(
            { name: 'doc', version: '1.0.0' },
            { onToolCall: vi.fn(), onResourceRead }
        );
        const dir = makeTempDir();
        const filePath = path.join(dir, 'gone.md');
        writeFileSync(filePath, 'content');
        server.registerDocument(filePath);
        rmSync(filePath);

        const resource = Object.values(resourcesOf(server))[0]!;
        await expect(
            resource.readCallback(new URL(pathToFileURL(filePath).toString()))
        ).rejects.toBeInstanceOf(McpError);
        expect(onResourceRead).toHaveBeenCalledTimes(1);
        const info = onResourceRead.mock.calls[0]![0];
        expect(info.uri).toBe(pathToFileURL(filePath).toString());
        expect(info.ok).toBe(false);
        expect(info.durationMs).toBeGreaterThanOrEqual(0);
    });
});
