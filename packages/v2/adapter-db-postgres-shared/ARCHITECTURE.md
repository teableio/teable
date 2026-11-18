Declaration: If the folder I belong to changes, please update me.

# v2 adapter-db-postgres-shared Architecture Notes

## Responsibilities

- Define shared Postgres DB tokens and config schema used by Postgres adapters.
- Provide the UnitOfWork implementation for Kysely-backed Postgres adapters.
- Keep all shared exports browser-safe (no Node-only dependencies).

## Subfolders

- `src/di/` - shared DI tokens for Postgres DB adapters.

## Files

- `src/config.ts` - shared Postgres connection config schema.
- `src/di/tokens.ts` - shared Postgres DB tokens.
- `src/unitOfWork.ts` - UnitOfWork implementation based on Kysely transactions: owns top-level
  transaction execution with bounded `40P01`/`40001` retries, re-entrant batch transaction reuse and
  `rollback-only` tracking, split Meta/Data cross-database batch rejection
  (`batch.cross_database_not_atomic`), and `savepoint()` isolation across SQL state as well as both
  batch and `PostgresUnitOfWorkTransaction` `afterCommit`/`afterRollback` handler queues.
- `src/index.ts` - Package public exports.
