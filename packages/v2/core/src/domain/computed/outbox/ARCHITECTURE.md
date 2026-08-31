Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# computed/outbox Architecture Notes

## Responsibilities

- Domain types and pure rules for computed-update outbox maintenance:
  pause scopes, dead-letter/stale anomalies, error-signature grouping, and
  task lineage (source mutation, run chain, DAG plan).
- No persistence, queues, or HTTP. Adapters implement `IComputedOutboxAdmin`.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe outbox domain scope.
- `errorSignature.ts` - Role: pure helper; Purpose: collapse volatile digits in error text.
- `groupAnomalies.ts` - Role: domain function; Purpose: group dead/stale tasks by root cause.
- `queueJobs.ts` - Role: read-model projection; Purpose: collapse, filter, facet, and page wakeup jobs.
- `types.ts` - Role: shared DTOs; Purpose: pause/anomaly/overview/queue shapes used by ports and CQRS.
- `lineage.ts` - Role: read-model DTOs; Purpose: task/run-chain/DAG shapes for lineage queries.
- `index.ts` - Role: barrel; Purpose: export outbox domain types.

## Examples

- `packages/v2/core/src/domain/computed/outbox/groupAnomalies.spec.ts`
- `packages/v2/core/src/domain/computed/outbox/queueJobs.spec.ts`
