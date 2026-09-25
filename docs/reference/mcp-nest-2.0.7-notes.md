# @rekog/mcp-nest@2.0.7: API facts for the spec

Sources:
- `PKG` = the npm tarball `src/` (the npm tarball, 2.0.7)
- `REPO` = GitHub `rekog-labs/MCP-Nest`, tag `v2.0.7` 
- `PROBE11` = a throwaway probe app: a runnable probe on Nest 11.2.6, SDK 2.1.0, zod 4.6.5, vitest 5.0.2 + unplugin-swc 2.0.0, Node 24.19.0. Tests are in `test/*.spec.ts`, and all of them pass.
- `PROBE12` = a throwaway probe app: the same app on Nest 12.1.0 as ESM (`"type":"module"`)

Tags: [Confirmed: …] means read in source or docs, or observed in a probe run. [Inferred] means not verified.

Heads-up: v2 has **no `McpModule`**. It is a Nest microservice `CustomTransportStrategy` (`McpStrategy`), and the tools live on `@McpController()` classes in a module's `controllers`. [Confirmed: REPO CLAUDE.md "Gotchas"; docs/migration-to-v2.md]
The README install line `npm install @rekog/mcp-nest @modelcontextprotocol/sdk zod@^4` is **stale**. The v1 SDK is not used. [Confirmed: PKG package.json peers; REPO docs/migration-to-v2.md §0]

---

## 1. McpStrategy options

`new McpStrategy(options: McpServerOptions)` [Confirmed: PKG mcp/transport/mcp-server-options.interface.ts:43-236, mcp.strategy.ts:149]

```ts
interface McpServerOptions {
  name: string; version: string;             // required
  server?: string;                           // named server, for multi-server isolation
  title?: string; description?: string; websiteUrl?: string; icons?: Icon[];
  capabilities?: ServerCapabilities;         // merged with the auto-derived ones
  instructions?: string;                     // sent on initialize / server/discover
  transports: McpTransport[];                // required
  httpAdapter?: HttpServer;                  // or strategy.setHttpAdapter(app.getHttpAdapter())
  allowUnauthenticatedAccess?: boolean;      // "freemium" mode for @PublicTool
  resolveUser?: (raw: unknown) => AuthenticatedUser | undefined; // must be sync; default reads raw.user
  logging?: false | { level: ('log'|'error'|'warn'|'debug'|'verbose')[] };
  serverMutator?: (s: McpServer) => McpServer;
  cacheHints?; requestState?; inputRequired?;  // 2026-07-28 features: MRTR and cache hints
}
```

- Capabilities are derived automatically. Any tools give `tools: { listChanged: true }`, and `logging: {}` is always added unless you pass `capabilities: { logging: undefined }`. [Confirmed: mcp.strategy.ts:441-461; the PROBE11 initialize response showed `{"tools":{"listChanged":true},"logging":{}}`]
- `logging` only controls the **strategy's own Nest Logger** (it becomes a NoOp or filtered logger). It does not touch the app logger. [Confirmed: utils/mcp-logger.factory.ts:97-118]
- **Built from runtime config:** it is a plain object, and there is no `forRootAsync`. Build it in `bootstrap()` after loading config and before `connectMicroservice`. [Confirmed: REPO docs/server-examples.md "Async Configuration"] Verified pattern (PROBE11 `src/app.ts`, `buildStrategy` + `AppModule.forRoot(cfg, strategy, transport)`):

```ts
const http = new StreamableHttpTransport();
const mcp = new McpStrategy({ name, version, instructions, transports: [http], logging: false });
const app = await NestFactory.create(AppModule.forRoot(cfg, mcp, http));
mcp.setHttpAdapter(app.getHttpAdapter());
app.connectMicroservice({ strategy: mcp });   // see §6 for { inheritAppConfig: true }
await app.startAllMicroservices();            // BEFORE listen()
await app.listen(port);
```

- The `MCP_STRATEGY` token (string `'MCP_STRATEGY'`) is only needed if a provider injects the strategy, for example for `registerTool`. [Confirmed: mcp.strategy.ts:72]

## 2. StreamableHttpTransport

`new StreamableHttpTransport(options?: StreamableHttpTransportOptions)` [Confirmed: PKG transport/transports/streamable-http.transport.ts:99-262, 313-337]

| option | default | notes |
|---|---|---|
| `endpoint` | `'/mcp'` | Applies to the **self-mount only**. It is ignored, with a warning, when a controller owns the route |
| `statefulMode` | `false` | Stateless is the default. In stateless mode GET and DELETE return 405 with a JSON-RPC body |
| `enableJsonResponse` | `!statefulMode` | Legacy era only |
| `sessionIdGenerator` | randomUUID | Legacy era only |
| `protocol` | `'dual'` | `'dual' \| 'modern-only' \| 'legacy-only'` (the modern era is `2026-07-28`) |
| `responseMode` | `'auto'` | Modern era: `'auto' \| 'sse' \| 'json'` |
| `security` | off | `{ allowedOrigins?, allowedHosts? }` (string[] or `'localhost'`). Rejections get 403 |
| `stepUpAuthorization` | false | 403 plus `WWW-Authenticate insufficient_scope`, for `@ToolScopes` |
| `mount` | auto | Self-mounts **unless** `transport.httpHandlers` has been read |

- **Dual-era:** each POST is classified with the SDK's `classifyInboundRequest`. Modern traffic goes to `createMcpHandler` and 2025-era traffic goes to `NodeStreamableHTTPServerTransport`. [Confirmed: streamable-http.transport.ts:603-665] PROBE11 ran the same suite with a legacy client and with a client pinned to `2026-07-28`, and both passed.
- **There are two ways to mount it:**
  1. Self-mount: `adapter.post/get/delete(endpoint, …)` is registered directly on the Nest HTTP adapter during `startAllMicroservices()`. This is **outside the Nest pipeline**: no guards, global prefix or versioning. [Confirmed: :534-577]
  2. Bring your own controller (the recommended way when you need auth): `class X extends McpHttpControllerFor(transport)` with `@Controller('mcp')`. It binds `@Post()/@Get()/@Delete()` with `@Req() @Res()`. Reading `httpHandlers` turns the self-mount off automatically. [Confirmed: transport/streamable-http.controller.ts:35-56; transport :525-532] Alternative: `extends StreamableHttpController` plus `{ provide: MCP_HTTP_HANDLER, useValue: transport.httpHandlers }`. [Confirmed: :96-114]
- **Adapter:** Express and Fastify are both detected at runtime (`HttpAdapterFactory`). `@nestjs/platform-fastify` is an optional peer, and **Express is the default** (`express >=4` peer). [Confirmed: adapters/http-adapter.factory.ts; package.json peers] Verified here on Express 5.2.1 via platform-express 11 and 12.
- Body: the transport uses `req.body` if a parser already ran, and otherwise reads the raw stream. [Confirmed: read-body.ts:225-251] With a BYO controller on Express, Nest's json body-parser runs first, so Nest's default body limit (100kb) applies to MCP POSTs. [Inferred: default Nest/body-parser behaviour, not probed]

## 3. StdioTransport

`new StdioTransport({ legacy?: 'serve' | 'reject' })`. The default is `'serve'`, which serves both eras on one connection. [Confirmed: PKG transports/stdio.transport.ts:7-79] It uses `serveStdio` from `@modelcontextprotocol/server/stdio` and needs no HTTP adapter.

A stdio-only bootstrap, verified with `StdioClientTransport` in both legacy and `mode:'auto'` (modern) runs [Confirmed: PROBE11 `src/main-stdio.ts` + `stdio-client.mjs`]:

```ts
const mcp = new McpStrategy({ name, version, transports: [new StdioTransport()], logging: false });
const app = await NestFactory.createMicroservice(AppModule.forRoot(cfg, mcp), { strategy: mcp, logger: false });
await app.listen();
```

- stdout is the protocol. Nest's `ConsoleLogger` writes every level except `error` to **stdout**. [Confirmed: node_modules/@nestjs/common/services/console-logger.service.js:163,181] That means `logger: false`, or a logger that writes to stderr (such as nestjs-pino pointed at fd 2), is mandatory, plus `logging: false` on the strategy. [Confirmed: REPO docs/server-examples.md "STDIO Server"]
- The transport holds a keep-alive interval during async bootstrap so the process does not exit early. [Confirmed: stdio.transport.ts:42-45]
- Session in stdio: `{ transport:'stdio', stateless:false, era:'legacy'|'modern' }`, and `getRawRequest()` is `undefined`. [Confirmed: PROBE11 output]

## 4. @Tool options

[Confirmed: PKG decorators/tool.decorator.ts:56-83]

```ts
interface ToolOptions {
  name?: string;              // defaults to the method name
  description?: string;
  parameters?: ToolInputSchema;   // z.ZodType | StandardSchemaV1 | raw JSON Schema; defaults to z.object({})
  outputSchema?: ToolInputSchema;
  annotations?: ToolAnnotations;  // = SDK ToolAnnotations
  _meta?: Record<string, any>;
}
```

- Annotation field names are the SDK's: `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. All five went through `tools/list` unchanged. [Confirmed: PROBE11 output]
- `inputSchema` is emitted as JSON Schema **draft 2020-12** through `z.toJSONSchema(..., { io: 'input' })`, and `.describe()` becomes `description`. [Confirmed: transport/tool-schema.ts; PROBE11 output]
- `_meta` on every listed tool also gets `securitySchemes` (for example `[{type:'noauth'}]`). [Confirmed: PROBE11; mcp.strategy.ts:670-676]
- Handler signature: `method(@Payload() args, @Ctx() ctx: McpContext, @McpRawRequest() req?)`. If you use `@Ctx()` or `@McpRawRequest()`, then `@Payload()` is required. [Confirmed: REPO docs/tools.md]
- Arguments are validated **before** the pipeline runs. A failure returns `{isError:true, content:[{text:'Invalid parameters: [name]: Invalid input: expected string, received number'}]}`. [Confirmed: mcp.strategy.ts:726-742; PROBE11]
- Return shaping [Confirmed: mcp.strategy.ts:900-922; PROBE11]:
  - An object with `content: []` is passed through unchanged.
  - Any other value becomes `{content:[{type:'text', text: JSON.stringify(value)}]}`. A plain string therefore comes out **quoted**, as `"\"just a string\""`.
  - With `outputSchema`, the return value is validated and sent as `structuredContent` plus JSON text. A mismatch gives a -32603 ProtocolError.
- Unknown tool: throws `ProtocolError` code **-32602** `Unknown tool: X`. [Confirmed: PROBE11]

## 5. Per-request context (McpContext)

[Confirmed: PKG transport/mcp-context.ts:119-473]
- `ctx.getRawRequest<T>()`: the Express request (the raw `IncomingMessage` under Fastify), or `undefined` on stdio. `@McpRawRequest()` is shorthand for the same thing.
- `ctx.getUser<T>()`: the result of `resolveUser(raw)`, falling back to `raw.user`. It is cached per request.
- `ctx.getSession()`: `{ transport, stateless, era, sessionId? }`
- Also: `ctx.mcpRequest`, `ctx.mcpServer`, `ctx.reportProgress()`, `ctx.log.*`, `getProtocolVersion()`, `getClientInfo()`, `getClientCapabilities()` (the last three are modern era only), `getTraceContext()`, and the MRTR accessors.
- PROBE11 results for stateless HTTP on both eras, and on stdio: `authViaCtx: "Bearer secret"`, `authViaDecorator: "Bearer secret"`, `user: {sub:'token-holder'}` (set by the HTTP guard), session `{transport:'streamable-http', stateless:true, era:'legacy'|'modern'}`. On stdio and in-memory, raw and user are `null`/`undefined`. [Confirmed]
- The raw request is bound per request, including in stateless mode, where a new SDK server is created for each POST. [Confirmed: streamable-http.transport.ts:677-702, 347-391]
- `ctx.log` and `reportProgress` do nothing in **legacy stateless** mode (they only log a local warn). On the modern era they work over the response stream. [Confirmed: mcp-context.ts:144-153; REPO docs/tools.md table]
- `@Inject(REQUEST)` resolves to the RPC context, **not** the HTTP request. [Confirmed: REPO docs/migration-to-v2.md §7]

## 6. Errors

Observed with PROBE11 on both eras:

| handler does | client gets |
|---|---|
| `return { content:[…], isError:true }` | passed through unchanged |
| `throw new RpcException('msg')` | `{isError:true, text:'msg'}` |
| `throw new Error('msg')` | `{isError:true, text:'Internal server error'}` (masked) |
| `throw new NotFoundException('msg')` (HttpException) | `{isError:true, text:'Internal server error'}` (masked) |
| RPC `@UseGuards` returns false | `{isError:true, text:'Forbidden resource'}` |
| a `ProtocolError` from the SDK | a JSON-RPC error (rethrown) |

Mechanism: Nest's `BaseRpcExceptionFilter` masks anything that is not an `RpcException`. The strategy's `toErrorResult` then converts it to `isError:true`. [Confirmed: mcp.strategy.ts:943-962]

To pass real messages through, use `McpExceptionFilter`, exported from the package. It is `@Catch()` and returns `throwError(() => ({status:'error', message}))`. [Confirmed: filters/mcp-exception.filter.ts] How you register it matters:
- **Class-level `@UseFilters(McpExceptionFilter)` on the `@McpController`** works without extra configuration: `throw_http` gives `"issue 42 not found"` and `throw_error` gives `"plain error message"`. [Confirmed: PROBE11 test/usefilters.spec.ts]
- **`APP_FILTER` in a hybrid app does NOT reach MCP tools** unless you call `app.connectMicroservice({ strategy }, { inheritAppConfig: true })`. [Confirmed: PROBE11 test/filter.spec.ts, where messages stayed masked without the flag and were surfaced with it]
- **Gotcha:** a global `@Catch()` `McpExceptionFilter` registered with APP_FILTER also catches **HTTP** exceptions. The 401 thrown by the HTTP guard then **hangs**: no response is sent, because the filter returns an Observable in an HTTP context. [Confirmed: PROBE11, the request aborted after 3s] So register it per controller, or use a subclass that branches on `host.getType()` and gives HTTP to Nest's `BaseExceptionFilter`. Do not simply rethrow: the probe showed that a rethrow falls through to Express's HTML error page.

Recommendation for the spec: put `@UseFilters(<our RpcExceptionFilter>)` on every `@McpController`, or use a shared base decorator. Map domain and GlitchTip errors to `RpcException(message)`, or return `{isError:true}` explicitly.

## 7. Auth: 401 before tools/list

- An RPC-layer `@UseGuards` on `@McpController` runs **only at tools/call**. `tools/list` still lists the tool. [Confirmed: REPO tests/mcp-tool-guards.e2e.spec.ts header; docs/tools.md]
- Per-tool **list filtering** happens only through `@ToolScopes/@ToolRoles/@PublicTool` + `allowUnauthenticatedAccess`, which read `req.user`. [Confirmed: mcp.strategy.ts:653-701]
- **The right way to return 401:** use an HTTP-layer guard on a BYO controller. It runs on every POST, GET and DELETE, before era routing, so both eras are covered:

```ts
@Controller('mcp')
@UseGuards(BearerGuard)          // reads req.headers.authorization; throws UnauthorizedException; may set req.user
class McpHttpController extends McpHttpControllerFor(httpTransport) {}
```

  [Confirmed: REPO docs/server-examples.md "Server with Authentication", docs/custom-controllers.md, migration-to-v2 §6 ("Authentication is guards-only"); PROBE11 shows `POST /mcp` with no bearer gives **401** `{"message":"Unauthorized","statusCode":401}` on both eras, and with the bearer set, `ctx.getUser()` returns the guard's `req.user`]
- The 401 body is Nest's default JSON, **not** JSON-RPC, and carries no `WWW-Authenticate` header. If the spec wants one, the guard should `res.setHeader('WWW-Authenticate','Bearer')` before throwing. [Inferred]
- The BYO controller is a normal Nest route, so `setGlobalPrefix` and versioning apply to it. The self-mount ignores them. [Confirmed: streamable-http.transport.ts:100-115]
- Alternative: Express middleware in front of a self-mounted route, together with `resolveUser`. Upstream uses this only as a special case (tests/utils.ts `configure` comment). [Confirmed: REPO tests/utils.ts:53-61] The guard is the documented path.
- A controller class can be declared **inside** `forRoot()` (closing over the transport instance), and it works. [Confirmed: PROBE11 `AppModule.forRoot`]

## 8. Conditional registration

- Discovery = Nest binds every `@MessagePattern` handler from the `controllers` of **all modules in the graph** into `strategy.messageHandlers`. At `listen()` the strategy reads the metadata straight off the method. There is no scanning of providers. [Confirmed: mcp.strategy.ts:271-328; REPO docs/tool-discovery-and-registration.md]
- A **dynamic module with a `controllers` array built at runtime** works. The probe ran `AppModule.forRoot({readOnly:true})` with `WriteTools` left out, and `write_thing` was missing from `tools/list`. Calling it gave `-32602 Unknown tool`. [Confirmed: PROBE11]
- Caveats:
  - A class that is only imported, and is not listed in some module's `controllers`, is **not** registered.
  - Registering tool classes as `providers` (the v1 habit) "starts successfully but leaves tools/list empty". [Confirmed: docs/server-examples.md STDIO section]
  - A named server whose tools list is empty only produces a warning.
  - An unnamed strategy prunes any non-MCP `@MessagePattern` handlers. [Confirmed: mcp.strategy.ts:278-283]
  - `retagMcpMethodsTransport` only sees methods declared **on the class itself**. Methods inherited from a base class are not re-tagged for named servers. [Confirmed: mcp-controller.decorator.ts:43-45] This only matters with `server:` names.
  - Duplicate tool names across controllers: both end up in the `tools` array (`find` picks the first). Unverified. [Inferred]
- Alternative: `strategy.registerTool({ name, description, parameters, outputSchema, annotations, _meta, handler:(args, ctx, rawReq)=>…, isPublic, requiredScopes, requiredRoles })`, `removeTool(name)`, and `registerResource` and `registerPrompt` in the same way. Call it in `onModuleInit` by injecting `MCP_STRATEGY`. **Dynamic handlers bypass the Nest RPC pipeline**, so no guards, pipes, interceptors or filters run. A throw there still becomes `isError`, unmasked, with `error.message`. [Confirmed: mcp.strategy.ts:982-1057, 943-962; REPO docs/dynamic-capabilities.md]

## 9. Testing

- There is **no in-memory or test utility in mcp-nest**. The upstream tests boot a real app with `Test.createTestingModule(...).createNestApplication()` and `listen(0)`, and drive it with `@modelcontextprotocol/client`. [Confirmed: REPO tests/utils.ts:67-106]
- **An in-memory transport is possible.** The SDK v2 exports `InMemoryTransport.createLinkedPair()` from both `@modelcontextprotocol/server` and `@modelcontextprotocol/client`. A 15-line custom `McpTransport` works [Confirmed: PROBE11 `InMemoryMcpTransport` + test "in-memory transport"]:

```ts
class InMemoryMcpTransport implements McpTransport {
  readonly kind = 'stdio' as const;            // McpTransportKind is 'stdio' | 'streamable-http' only
  readonly clientSide; private readonly serverSide;
  constructor() { [this.clientSide, this.serverSide] = InMemoryTransport.createLinkedPair(); }
  async start(ctx: McpTransportContext) {
    await ctx.createBoundServer({ transport: 'stdio', stateless: false, era: 'legacy' }).connect(this.serverSide);
  }
  async close() { await this.serverSide.close(); }
}
// test:
const ms = (await Test.createTestingModule({ imports: [...] }).compile()).createNestMicroservice({ strategy, logger: false });
await ms.listen();
const c = new Client({ name: 't', version: '1' }); await c.connect(t.clientSide);
await c.listTools(); await c.callTool({ name, arguments });
```

  This runs the real RPC pipeline (guards, filters, DI) with no network. It cannot exercise the HTTP guard, headers or the modern era. Keep a few HTTP tests on port 0 for those.
- HTTP test clients:
  - Legacy: `new Client({name,version})`
  - Modern: `new Client({name,version}, { versionNegotiation: { mode: { pin: '2026-07-28' } } })`
  - Transport: `new StreamableHTTPClientTransport(new URL(...), { requestInit: { headers: { authorization: 'Bearer …' } } })`
  - stdio: `StdioClientTransport` from `@modelcontextprotocol/client/stdio`, with `mode: 'auto'` for discover-then-fallback.

  [Confirmed: REPO docs/protocol-revisions.md "Testing each era"; PROBE11]
- The versions that worked, all verified together in PROBE11:
  - `@rekog/mcp-nest@2.0.7`
  - `@modelcontextprotocol/{server,core,node,client}@2.1.0`. The peer range is `^2.0.0-beta.5` and 2.1.0 is npm `latest`.
  - `hono@4` (a peer of `@modelcontextprotocol/node`, which must be installed)
  - `@nestjs/{common,core,microservices,platform-express,testing}@11.2.6` (npm `legacy` tag). `@nestjs/microservices` is a **required** peer.
  - `express@5.2.1` (via platform-express)
  - `rxjs@7.8.2`, `reflect-metadata@0.2.2`
  - `zod@4.6.5` (peer `^4.3.5`, and the SDK needs `^4.2.0`)
  - `vitest@5.0.2`, `unplugin-swc@2.0.0`, `@swc/core@1.16.2`, `typescript@5.9`

  Peer ranges come from PKG package.json. `@nestjs/*` is `>=9`, except that platform-fastify is `^11.1.5 || ^12`.
- **Nest 12** (npm `latest` 12.1.0) is **ESM-only** (`"type":"module"`, Node >=20). mcp-nest's dist is **CJS** (`require('@nestjs/common')`, `require('@modelcontextprotocol/server')`). On Node 24 the ESM app plus the CJS mcp-nest worked end to end: list, call, guard, validation and the HTTP Bearer guard. [Confirmed: PROBE12 `dist/main.js`] This relies on `require(esm)`, which is unflagged since Node 20.19 and 22.12. [Inferred] The SDK v2 packages ship both CJS and ESM (`exports.require` and `exports.import`). [Confirmed: npm view] Zod works across the CJS/ESM split too: validation produced the same messages. [Confirmed: PROBE12]

## 10. Gotchas

- **SWC/vitest:** use `unplugin-swc` (`swc.vite({ module: { type: 'es6' } })`) with `.swcrc` set to `legacyDecorator: true, decoratorMetadata: true`. Constructor DI in an `@McpController` worked under vitest (`Svc` injected). [Confirmed: PROBE11 `vitest.config.ts`, `.swcrc`] esbuild, which vitest uses by default, does not emit decorator metadata. [Inferred, well known]
- **`typescript@latest` on npm is 7.0.2** (the native port). The probe pinned 5.9 to be safe with `emitDecoratorMetadata`. TS 7's `tsc` was not checked. [Inferred risk]
- **ESM vs CJS:** covered in §9. The package has no `"type"` field and no `exports` map, so it is CJS only. [Confirmed: PKG package.json, dist/index.js `"use strict"` + `__createBinding`]
- **Node:** mcp-nest declares no `engines`. The SDK v2 and Nest 12 need Node >=20. [Confirmed: npm view] Node 24.19 worked.
- **Order:** `setHttpAdapter` → `connectMicroservice` → `startAllMicroservices()` → `listen()`. [Confirmed: README; docs]
- In a **hybrid app, `APP_FILTER`/`APP_GUARD`-style globals do not reach the MCP RPC handlers** without `inheritAppConfig: true`. APP_FILTER was confirmed in §6; the same is [Inferred] for global pipes and interceptors.
- `ctx.log` and progress do nothing in legacy stateless HTTP. On the modern era, logs are sent only when the client opts in with `io.modelcontextprotocol/logLevel`. [Confirmed: REPO docs/tools.md]
- A tool returning a bare string gets JSON-quoted. Return `{content:[{type:'text',text}]}` explicitly. [Confirmed: PROBE11]
- `x-mcp-header` annotations in a parameters schema throw at startup (SEP-2243 is not supported). [Confirmed: tool-schema.ts:268-296]
- The modern protocol string `2026-07-28` is not exported by the SDK. `LATEST_PROTOCOL_VERSION` is `2025-11-25`. [Confirmed: REPO CLAUDE.md]
- `elicitInput` and `createMessage` push calls throw on the modern era. Use MRTR `inputRequired()` instead. [Confirmed: REPO docs/tools.md]
