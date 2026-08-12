# LLM Chat MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![NPM](https://nodei.co/npm/@johannes.latzel/llm-chat-mcp.svg?style=shields&data=n,v,u,d,s)](https://www.npmjs.com/package/@johannes.latzel/llm-chat-mcp)
[![version](https://img.shields.io/github/package-json/v/johanneslatzel/llm-chat-mcp)](https://github.com/johanneslatzel/llm-chat-mcp/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat-mcp/pulls)
[![Feedback Welcome](https://img.shields.io/badge/feedback-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat-mcp/discussions)
[![codecov](https://codecov.io/gh/johanneslatzel/llm-chat-mcp/graph/badge.svg)](https://codecov.io/gh/johanneslatzel/llm-chat-mcp)
[![CI](https://github.com/johanneslatzel/llm-chat-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/johanneslatzel/llm-chat-mcp/actions/workflows/ci.yml)
[![Socket Badge](https://badge.socket.dev/npm/package/@johannes.latzel/llm-chat-mcp/latest)](https://badge.socket.dev/npm/package/@johannes.latzel/llm-chat-mcp/latest)
[![AI Assisted Yes](https://img.shields.io/badge/AI%20Assisted-Yes-green)](https://github.com/mefengl/made-by-ai)

MCP server library for the `@johannes.latzel/llm-chat` ecosystem. Wraps `Tool`
and `ToolPackage` instances behind the [Model Context Protocol][mcp] over stdio
or Streamable HTTP.

## Features

- **Stdio** and **Streamable HTTP** transports
- Register any `Tool` or `ToolPackage` from the llm-chat ecosystem
- Serve **documents as MCP resources** - register a file or an entire folder
  (every supported type by default) and clients can list and read them
- Multi-session HTTP - each client gets an isolated MCP session
- Automatic JSON Schema → Zod conversion for input validation

## Prerequisites

- Node.js >= 20

## Installation

```bash
npm install @johannes.latzel/llm-chat-mcp
```

## Documentation

Full documentation at **[johanneslatzel.github.io/llm-chat-mcp/](https://johanneslatzel.github.io/llm-chat-mcp/)**

## License

MIT. See [`LICENSE`](LICENSE).

## Contributing

Issues and PRs welcome at [github.com/johanneslatzel/llm-chat-mcp](https://github.com/johanneslatzel/llm-chat-mcp).

[mcp]: https://modelcontextprotocol.io
