import { describe, it, expect } from 'vitest';
import { HttpMcpServer } from '../index.js';
import { TestTool } from '../helper/test-tools.js';
import { startHttpServer, createSession, listTools, callTool } from '../helper/http-client.js';

async function startServer(): Promise<{ server: HttpMcpServer; port: number }> {
    const server = new HttpMcpServer({
        name: 'test-http',
        version: '1.0.0',
        port: 0
    });
    server.registerTool(new TestTool('shared-tool'));
    server.registerTool(new TestTool('other-tool'));
    return startHttpServer(server);
}

describe('tool state (HttpMcpServer)', () => {
    it('updates existing sessions live', async () => {
        const { server, port } = await startServer();
        const sessionId = await createSession(port);

        let body = await listTools(port, sessionId);
        expect(body).toContain('shared-tool');
        expect(body).toContain('other-tool');

        server.setDisabledTools(['shared-tool']);
        body = await listTools(port, sessionId);
        expect(body).not.toContain('shared-tool');
        expect(body).toContain('other-tool');

        server.setDisabledTools([]);
        body = await listTools(port, sessionId);
        expect(body).toContain('shared-tool');
        expect(body).toContain('other-tool');

        await server.stop();
    });

    it('applies to sessions created after the call', async () => {
        const { server, port } = await startServer();
        server.setDisabledTools(['shared-tool']);

        const sessionId = await createSession(port);
        const body = await listTools(port, sessionId);
        expect(body).not.toContain('shared-tool');
        expect(body).toContain('other-tool');

        await server.stop();
    });

    it('updates all concurrent sessions', async () => {
        const { server, port } = await startServer();
        const sessionA = await createSession(port);
        const sessionB = await createSession(port);

        server.setDisabledTools(['shared-tool']);
        const bodyA = await listTools(port, sessionA);
        const bodyB = await listTools(port, sessionB);
        expect(bodyA).not.toContain('shared-tool');
        expect(bodyB).not.toContain('shared-tool');

        await server.stop();
    });

    it('rejects calls to disabled tools in existing sessions', async () => {
        const { server, port } = await startServer();
        const sessionId = await createSession(port);
        server.setDisabledTools(['shared-tool']);

        const body = await callTool(port, sessionId, 'shared-tool');
        expect(body).toContain('disabled');

        await server.stop();
    });

    it('applies single-tool toggles to existing sessions live', async () => {
        const { server, port } = await startServer();
        const sessionId = await createSession(port);

        server.disableTool('shared-tool');
        let body = await listTools(port, sessionId);
        expect(body).not.toContain('shared-tool');
        expect(body).toContain('other-tool');

        server.enableTool('shared-tool');
        body = await listTools(port, sessionId);
        expect(body).toContain('shared-tool');
        expect(body).toContain('other-tool');

        await server.stop();
    });
});
