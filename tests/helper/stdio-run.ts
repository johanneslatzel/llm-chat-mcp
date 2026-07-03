import { StdioMcpServer, GreetTool } from '../index.js';

const server = new StdioMcpServer({
    name: 'test-server',
    version: '1.0.0'
});
server.register(new GreetTool());
await server.start();
