import { StdioMcpServer } from '../index.js';
import { NoParamTool } from './no-param-tool.js';

const server = new StdioMcpServer({
    name: 'no-params-server',
    version: '1.0.0'
});
server.register(new NoParamTool());
await server.start();
