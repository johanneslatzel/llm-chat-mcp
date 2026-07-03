import { StdioMcpServer, ErrorTool } from '../index.js';

const server = new StdioMcpServer({
    name: 'error-server',
    version: '1.0.0'
});
server.register(new ErrorTool());
await server.start();
