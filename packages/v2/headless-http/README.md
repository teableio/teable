# @teable/v2-headless-http

Hono transport for `@teable/v2-headless-runtime`.

```ts
import { serve } from "@hono/node-server";
import { createHeadlessRuntime } from "@teable/v2-headless-runtime";
import { createHeadlessHttpApp } from "@teable/v2-headless-http";

const runtime = await createHeadlessRuntime({
  backend: { kind: "pglite", dataDir: "./data" },
});

const app = createHeadlessHttpApp(runtime, {
  actorHeader: "x-teable-actor",
});

serve({ fetch: app.fetch, port: 3000 });
```

Authentication stays in the host. The adapter only resolves a request to an
actor id; use `resolveActorId` to plug in your session/token verification.

`createHeadlessClient` re-exports the typed `@teable/v2-contract-http-client`
factory for the same contract.
