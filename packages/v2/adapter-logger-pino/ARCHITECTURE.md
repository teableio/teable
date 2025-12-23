Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-logger-pino Architecture Notes

## Responsibilities

- Provide a Pino-backed ILogger adapter for v2 core logging.
- Export a shared Pino instance with a small helper for custom configuration.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe the adapter package scope.
- `src/PinoLoggerAdapter.ts` - Role: port adapter; Purpose: map ILogger to a Pino logger.
- `src/pino.ts` - Role: logger factory; Purpose: define the shared Pino instance.
- `src/index.ts` - Role: package entry; Purpose: export the adapter and logger helpers.

## Examples

- `packages/v2/adapter-logger-pino/src/PinoLoggerAdapter.ts` - ILogger adapter for Pino.
- `packages/v2/adapter-logger-pino/src/pino.ts` - Default Pino instance and factory.
