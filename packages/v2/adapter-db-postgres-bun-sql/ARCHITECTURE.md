Declaration: If the folder I belong to changes, please update me.

# v2 adapter-db-postgres-bun-sql Architecture Notes

## Responsibilities

- Provide the Kysely Bun SQL dialect backed by Bun's native SQL client.
- Register a Kysely instance into the shared Postgres DB tokens.
- Re-export shared Postgres tokens/config and UnitOfWork from the shared adapter package.

## Subfolders

- `src/di/` - DI registration helpers for the bun-sql dialect.

## Files

- `src/createDb.ts` - Kysely + BunPostgresDialect factory.
- `src/di/register.ts` - DI registration for the bun-sql dialect.
- `src/index.ts` - Package public exports.
