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
  resolveIdentity: async (request) => {
    const actorId = await authenticate(request);
    return actorId ? { status: "accepted", actorId } : { status: "rejected", statusCode: 401 };
  },
});

serve({ fetch: app.fetch, port: 3000, hostname: "127.0.0.1" });
```

Authentication stays in the host. `resolveIdentity` can explicitly accept or
reject; a rejection never falls back to headers or `system`. The legacy
`resolveActorId` seam remains for compatible trusted hosts, but configuring both
fails fast. A request with no actor and no `defaultActorId` is rejected with 401;
`allowAnonymousActor: true` opts back into the legacy `system` actor. `/health`
(liveness) and `/ready` (database probe) bypass identity.

Every adapter-owned response uses `{ok,data}` / `{ok:false,error}`, including
404, resolver failures, and internal errors; unexpected messages and stacks are
not reflected. Drain routes return structured reports:

```text
POST /runtime/flushComputed
POST /runtime/flushRealtime
POST /runtime/flushBackground
```

This package is not an auth boundary. Do not expose it to an untrusted network
without a host authentication and authorization layer.

`createHeadlessClient` re-exports the typed `@teable/v2-contract-http-client`
factory for the table contract.
