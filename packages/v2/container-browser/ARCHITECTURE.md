Declaration: If the folder I belong to changes, please update me.

# v2 container-browser Architecture Notes

## Responsibilities

- Provide the default browser DI wiring using a PGlite-backed Postgres DB.
- Wire core application services and in-memory command/query/event buses.
- Register the in-memory domain write transaction required by record updates.
- Forward `computedUpdate` configuration to the table repository adapter.
- Expose a noop container option for cases where persistence is not needed.

## Subfolders

- None.

## Files

- `src/index.ts` - Browser container registrations and factories.

## Notes

- `options.connectionString` is used as the PGlite data directory (defaults to `memory://`).
- The domain write transaction uses an in-memory projection journal and the
  in-memory dispatchers; there is no durable event outbox worker.
- The computed update worker is registered but not started. The host must drain
  it (for example via a runtime `flushComputed()` helper).
