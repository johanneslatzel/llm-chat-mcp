import { StdioMcpServer, GreetTool } from '../index.js';
import { NoParamTool } from './no-param-tool.js';

const server = new StdioMcpServer({
    name: 'package-server',
    version: '1.0.0'
});
server.registerTool(new GreetTool());
server.registerTool(new NoParamTool());
await server.start();
