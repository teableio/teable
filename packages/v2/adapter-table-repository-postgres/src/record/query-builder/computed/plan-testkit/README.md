# Native PostgreSQL formula plan gate

This suite builds domain tables, compiles formulas through `SameTableBatchQueryBuilder`, and executes the production `UpdateFromSelectBuilder` UPDATE under `EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON)`. It checks values as well as plan size and actual extraction loops. PGlite and SQL snapshots cannot replace this gate.

Run against a dedicated disposable PostgreSQL 16 or 17 database (the suite creates and drops the `bseplanregression01` schema):

```sh
FORMULA_PLAN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/formula_plan \
  pnpm --filter @teable/v2-adapter-table-repository-postgres exec vitest run \
  --config vitest.formula-plan.config.ts \
  src/record/query-builder/computed/SameTableBatchQueryBuilder.pg-plan.spec.ts
```

A missing database URL fails the gate; ordinary unit tests exclude these files. `statement_timeout` bounds both planning and execution. SQL and bound parameters are saved before EXPLAIN so timeout/OOM failures retain a reproducer. Planning-only JSON is saved before execution; PostgreSQL 17 also enforces a 16 MiB planning-memory allocation budget through EXPLAIN MEMORY. PostgreSQL 16 does not expose this metric and relies on the container limit. ANALYZE JSON is retained afterwards. Set `FORMULA_PLAN_ARTIFACT_DIR` to choose the artifact directory.

The `Formula PostgreSQL Plan Gate` workflow runs both optimizer versions with a 512 MiB PostgreSQL container limit and no additional swap. Connection failures, timeouts, excessive plans, wrong results, duplicated extraction loops, server OOM, or recovery/restart fail the job. Artifacts include SQL, JSON plans, container state and PostgreSQL logs. Configure both matrix jobs as required branch checks to enforce the merge gate.

Plan budgets are regression bounds for small representative fixtures, not an estimate of production memory. The attachment assertion specifically requires one JSON extraction per input row. Nested branches additionally check growth across depths 2, 4 and 8. Do not update a budget just to accept a larger generated plan; inspect the retained expressions and execution loops first.
