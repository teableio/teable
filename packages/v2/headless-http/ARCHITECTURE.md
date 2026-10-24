Declaration: If the folder I belong to changes, please update me.

# v2/headless-http Architecture Notes

## Responsibilities

- Mount the v2 oRPC contract as a Hono app over a headless runtime container.
- Resolve a request to an actor id and run the handler inside that context.
- Re-export the typed contract HTTP client as the runtime SDK seam.

## Boundaries

- Authentication and authorization stay in the host; this package only maps
  identity into `IExecutionContext`.
- No domain logic and no direct database access.
- The v2 contract path is unchanged; a host that mounts under a prefix must strip
  that prefix before the v2 middleware (see contract-http-hono notes).

## Files

- `src/index.ts` - `createHeadlessHttpApp`, `createHeadlessClient`.
- `src/index.spec.ts` - create/list base through Hono `app.request`.

## Notes

- `createExecutionContext` receives no request; this adapter uses
  `AsyncLocalStorage` set by a preceding Hono middleware.
- The default actor is `system` when no header or resolver is supplied.
