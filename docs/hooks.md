# Hooks

Servers expose lifecycle hooks in the style of `@johannes.latzel/llm-chat`:
`server.hook()` returns a fluent builder, and each builder's `do(callback)`
registers the callback and returns a disposable `Hook`. Callbacks (sync or
async) run fire-and-forget; errors are caught and logged, so a hook never
breaks the server. Call `hook.dispose()` to unsubscribe.

## `started`

Fires once the server has connected its transport (after `start()` completes).
For `HttpMcpServer`, `start()` is idempotent and the event fires exactly once.

```ts
server
    .hook()
    .started()
    .do(() => {
        console.log('server ready');
    });
```

## `toolRegistered(name)`

Fires for every tool registered via `registerTool`. Pass tool names to filter;
with no names the hook fires for every tool.

```ts
server
    .hook()
    .toolRegistered('greet')
    .do((name) => {
        console.log(`tool registered: ${name}`);
    });
```

## `documentRegistered(info)`

Fires when a document resource is registered (`registerDocument`,
`registerFolder`, `registerContentDocument`). The payload is
`{ kind: DocumentKind, name?: string }`; `name` is omitted for folders (their
resources are named per-file).

```ts
server
    .hook()
    .documentRegistered()
    .do(({ kind, name }) => {
        console.log(`registered ${kind}${name ? ` ${name}` : ''}`);
    });
```

## `sessionCreated(sessionId)` / `sessionDisposed(sessionId)`

HTTP-only events, available on `HttpMcpServer`. `sessionCreated` fires when an
initial `POST /mcp` yields a session id; `sessionDisposed` fires when a session
is torn down via `DELETE /mcp` or when `stop()` closes all sessions.

```ts
const server = new HttpMcpServer({ name: 'demo', version: '1.0.0', port: 3000 });
server
    .hook()
    .sessionCreated()
    .do((sessionId) => console.log('created', sessionId));
server
    .hook()
    .sessionDisposed()
    .do((sessionId) => console.log('disposed', sessionId));
```

## Error handling

Callbacks never break the server:

- A callback that throws synchronously is caught and logged.
- An async callback that rejects is caught and logged: no unhandled rejection.
- A throwing callback does not prevent other subscribers from firing.
- `hook.dispose()` is idempotent and unsubscribes from the underlying emitter.

## Reference

| Method                                   | Event                | Payload                        |
| ---------------------------------------- | -------------------- | ------------------------------ |
| `hook().started().do(cb)`                | `started`            | —                              |
| `hook().toolRegistered(...names).do(cb)` | `toolRegistered`     | `name: string`                 |
| `hook().documentRegistered().do(cb)`     | `documentRegistered` | `info: DocumentRegisteredInfo` |
| `hook().sessionCreated().do(cb)`         | `sessionCreated`     | `sessionId: string`            |
| `hook().sessionDisposed().do(cb)`        | `sessionDisposed`    | `sessionId: string`            |

`DocumentRegisteredInfo` and the builder classes (`McpServerHookBuilder`,
`HttpServerHookBuilder`) are exported from the package root. The HTTP session
events are only reachable through `HttpServerHookBuilder` (returned by
`HttpMcpServer.hook()`).
