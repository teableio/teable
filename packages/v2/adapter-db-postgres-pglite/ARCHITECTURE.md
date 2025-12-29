Declaration: If the folder I belong to changes, please update me.

# v2 adapter-db-postgres-pglite Architecture Notes

## Responsibilities

- Provide the Kysely PGlite dialect backed by `@electric-sql/pglite`.
- Register a Kysely instance into the shared Postgres DB tokens.
- Re-export shared Postgres tokens/config and UnitOfWork from the shared adapter package.

## Subfolders

- `src/di/` - DI registration helpers for the pglite dialect.

## Files

- `src/createDb.ts` - Kysely + KyselyPGlite dialect factory.
- `src/di/register.ts` - DI registration for the pglite dialect.
- `src/index.ts` - Package public exports.

## Notes

- `pg.connectionString` is treated as the PGlite data directory (for example `memory://`).
