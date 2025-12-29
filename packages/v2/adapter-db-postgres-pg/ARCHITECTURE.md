Declaration: If the folder I belong to changes, please update me.

# v2 adapter-db-postgres-pg Architecture Notes

## Responsibilities

- Provide the Kysely Postgres dialect backed by the `pg` driver.
- Re-export shared Postgres DB tokens/config schema and the UnitOfWork implementation from the shared adapter package.
- Expose DI helpers for registering the database into containers.

## Subfolders

- `src/di/` - DI registration helpers and shared tokens.

## Files

- `src/config.ts` - Re-exported Postgres connection config schema.
- `src/createDb.ts` - Kysely + `pg` dialect factory.
- `src/unitOfWork.ts` - Re-exported transaction wrapper for v2 UnitOfWork.
- `src/index.ts` - Package public exports.
