Declaration: If the folder I belong to changes, please update me.

# v2 container-browser Architecture Notes

## Responsibilities

- Provide the default browser DI wiring using a PGlite-backed Postgres DB.
- Wire core application services and in-memory command/query/event buses.
- Expose a noop container option for cases where persistence is not needed.

## Subfolders

- None.

## Files

- `src/index.ts` - Browser container registrations and factories.

## Notes

- `options.connectionString` is used as the PGlite data directory (defaults to `memory://`).
