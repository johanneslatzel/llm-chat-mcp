import { HttpMcpServer, GreetTool } from '../index.js';

const server = new HttpMcpServer({
    name: 'test-http',
    version: '1.0.0',
    port: 8081
});
server.register(new GreetTool());
await server.start();
