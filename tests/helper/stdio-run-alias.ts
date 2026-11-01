import { StdioMcpServer } from '../index.js';
import { AliasTool } from './test-tools.js';

const server = new StdioMcpServer({
    name: 'test-stdio-alias',
    version: '1.0.0'
});
server.registerTool(new AliasTool());
await server.start();
