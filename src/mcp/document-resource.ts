import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpError, ErrorCode, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer, ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerObserver } from './observer.js';

/** Configuration for registering a single file as an MCP resource. */
export type FileDocumentConfig = {
    /** Path to the file. */
    path: string;
    /** Resource name shown in `resources/list`. Defaults to the file's basename. */
    name?: string;
    /** Resource title shown by clients. */
    title?: string;
    /** Resource description shown by clients. */
    description?: string;
    /** Override the MIME type inferred from the file extension. */
    mimeType?: string;
};

/** Configuration for registering a folder; every matching file becomes a static resource. */
export type FolderDocumentConfig = {
    /** Path to the folder. */
    path: string;
    /** Resource title applied to every resource created from this folder. */
    title?: string;
    /** Resource description applied to every resource created from this folder. */
    description?: string;
    /** Override the MIME type for every resource created from this folder. */
    mimeType?: string;
    /** File extensions to include (case-insensitive, with or without leading dot). Defaults to every supported type. */
    extensions?: string[];
};

/** Internal, normalized representation of a registered file document. */
export type FileEntry = {
    kind: 'file';
    path: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
};

/** Internal, normalized representation of a registered folder document. */
export type FolderEntry = {
    kind: 'folder';
    path: string;
    title?: string;
    description?: string;
    mimeType?: string;
    extensions: string[];
};

/** Union of the two internal document entries. */
export type DocumentEntry = FileEntry | FolderEntry;

const MIME_TYPES: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    text: 'text/plain',
    json: 'application/json',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    xml: 'application/xml',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
};

/** Infer a MIME type from a file extension, falling back to `application/octet-stream`. */
function inferMimeType(filePath: string): string {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** Return `true` when a MIME type should be served as UTF-8 text instead of a base64 blob. */
function isTextMimeType(mimeType: string): boolean {
    return (
        mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/xml' ||
        mimeType === 'application/yaml' ||
        mimeType === 'image/svg+xml'
    );
}

/** The folder default: every extension the server knows how to serve. */
const DEFAULT_EXTENSIONS: string[] = Object.keys(MIME_TYPES);

/** Normalize configured extensions to lowercase without leading dots, defaulting to all supported types. */
function normalizeExtensions(extensions: string[] | undefined): string[] {
    const chosen =
        extensions !== undefined && extensions.length > 0 ? extensions : DEFAULT_EXTENSIONS;
    return chosen.map((ext) => ext.replace(/^\./, '').toLowerCase());
}

/** Return `true` when a file name matches one of the (already normalized) extensions. */
function matchesExtension(fileName: string, extensions: string[]): boolean {
    const ext = path.extname(fileName).slice(1).toLowerCase();
    return extensions.includes(ext);
}

/** Recursively collect the absolute paths of all files matching `extensions` inside `dir`. */
function collectDocuments(dir: string, extensions: string[]): string[] {
    const documents: string[] = [];
    const stack: string[] = [dir];
    while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && matchesExtension(entry.name, extensions)) {
                documents.push(fullPath);
            }
        }
    }
    return documents.sort();
}

/** Create a normalized file entry, resolving the path and validating that it is a file. */
export function createDocumentEntry(config: FileDocumentConfig): FileEntry {
    const absPath = path.resolve(config.path);
    const stats = statSync(absPath);
    if (!stats.isFile()) {
        throw new Error(`Document path is not a file: ${absPath}`);
    }
    return {
        kind: 'file',
        path: absPath,
        name: config.name ?? path.basename(absPath),
        ...(config.title !== undefined ? { title: config.title } : {}),
        ...(config.description !== undefined ? { description: config.description } : {}),
        ...(config.mimeType !== undefined ? { mimeType: config.mimeType } : {})
    };
}

/** Create a normalized folder entry, resolving the path and validating that it is a directory. */
export function createFolderEntry(config: FolderDocumentConfig): FolderEntry {
    const absPath = path.resolve(config.path);
    const stats = statSync(absPath);
    if (!stats.isDirectory()) {
        throw new Error(`Folder path is not a directory: ${absPath}`);
    }
    return {
        kind: 'folder',
        path: absPath,
        extensions: normalizeExtensions(config.extensions),
        ...(config.title !== undefined ? { title: config.title } : {}),
        ...(config.description !== undefined ? { description: config.description } : {}),
        ...(config.mimeType !== undefined ? { mimeType: config.mimeType } : {})
    };
}

/** Build the `ResourceMetadata` for a resource, inferring the MIME type unless overridden. */
function buildMetadata(entry: {
    path: string;
    title?: string;
    description?: string;
    mimeType?: string;
}): ResourceMetadata {
    const metadata: ResourceMetadata = { mimeType: entry.mimeType ?? inferMimeType(entry.path) };
    if (entry.title !== undefined) {
        metadata.title = entry.title;
    }
    if (entry.description !== undefined) {
        metadata.description = entry.description;
    }
    return metadata;
}

/** Read a file into an MCP `ReadResourceResult`, as text or a base64 blob depending on MIME type. */
async function readResource(
    uri: URL,
    absPath: string,
    mimeType: string,
    observer?: McpServerObserver
): Promise<ReadResourceResult> {
    const started = Date.now();
    try {
        const buffer = await readFile(absPath);
        observer?.onResourceRead({
            uri: uri.toString(),
            ok: true,
            durationMs: Date.now() - started
        });
        if (isTextMimeType(mimeType)) {
            return { contents: [{ uri: uri.toString(), mimeType, text: buffer.toString('utf8') }] };
        }
        return { contents: [{ uri: uri.toString(), mimeType, blob: buffer.toString('base64') }] };
    } catch {
        observer?.onResourceRead({
            uri: uri.toString(),
            ok: false,
            durationMs: Date.now() - started
        });
        throw new McpError(ErrorCode.InvalidParams, `Failed to read resource ${uri.toString()}`);
    }
}

/** Register a single file as a static MCP resource. */
export function registerFileResourceOnServer(
    mcpServer: McpServer,
    entry: FileEntry,
    observer?: McpServerObserver
): void {
    const uri = pathToFileURL(entry.path).toString();
    const metadata = buildMetadata(entry);
    const mimeType = entry.mimeType ?? inferMimeType(entry.path);
    mcpServer.registerResource(entry.name, uri, metadata, async (requestedUri) =>
        readResource(requestedUri, entry.path, mimeType, observer)
    );
}

/** Register every matching file in a folder as a static MCP resource. Registers nothing when empty. */
export function registerFolderResourcesOnServer(
    mcpServer: McpServer,
    entry: FolderEntry,
    observer?: McpServerObserver
): void {
    const files = collectDocuments(entry.path, entry.extensions);
    for (const file of files) {
        registerFileResourceOnServer(
            mcpServer,
            {
                kind: 'file',
                path: file,
                name: path.relative(entry.path, file).split(path.sep).join('/'),
                ...(entry.title !== undefined ? { title: entry.title } : {}),
                ...(entry.description !== undefined ? { description: entry.description } : {}),
                ...(entry.mimeType !== undefined ? { mimeType: entry.mimeType } : {})
            },
            observer
        );
    }
}
