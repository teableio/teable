# Table Query Ops PostgreSQL schema ownership

The operational tables in this package are adapter-owned infrastructure, not
application data models. `ensureTableQueryOpsSchema` in `src/schema.ts` is the
canonical, idempotent schema definition for them. This keeps the optional v2
adapter deployable without adding its internal observation, recommendation,
task, lease, and search-path state to the main Prisma client.

Production registration must either enable `ensureSchema` or provision the
exact schema from `ensureTableQueryOpsSchema` before starting workers. Schema
changes must remain backward-compatible and idempotent because existing
installations are upgraded by the same function. The search access-path reclaim
columns intentionally live here for the same reason; they persist the durable
disable/grace/drop workflow owned by this adapter. Reclaim uses PostgreSQL's
row version (`xmin`) for its short-lived optimistic check and treats a due-drop
claim as a 24-hour lease, so a crash between claiming and enqueueing is
recoverable on a later sweep.
