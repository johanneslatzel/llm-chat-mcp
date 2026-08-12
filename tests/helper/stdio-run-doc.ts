import { StdioMcpServer } from '../index.js';
import path from 'node:path';

const server = new StdioMcpServer({
    name: 'doc-server',
    version: '1.0.0'
});
server.registerFolder(path.resolve('tests/helper/docs'));
await server.start();
