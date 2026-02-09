Declaration: If the folder I belong to changes, please update me.

# v2 adapter-db-postgres-postgresjs Architecture Notes

## Responsibilities

- Provide the Kysely Postgres.js dialect backed by `postgres`.
- Register a Kysely instance into the shared Postgres DB tokens.
- Re-export shared Postgres tokens/config and UnitOfWork from the shared adapter package.

## Subfolders

- `src/di/` - DI registration helpers for the postgresjs dialect.

## Files

- `src/createDb.ts` - Kysely + PostgresJSDialect factory.
- `src/di/register.ts` - DI registration for the postgresjs dialect.
- `src/index.ts` - Package public exports.
