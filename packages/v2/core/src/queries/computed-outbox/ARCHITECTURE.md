Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# queries/computed-outbox Architecture Notes

## Responsibilities

- Read-side CQRS for computed-update outbox maintenance (overview, pauses,
  anomalies, queue jobs, and task lineage).
- `ListComputedOutboxQueueJobsHandler` projects scanned wakeup jobs through
  `projectComputedOutboxQueueJobs`. Other queries delegate to `IComputedOutboxAdmin`.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe outbox query scope.
- `GetComputedOutboxOverviewQuery.ts` / `GetComputedOutboxOverviewHandler.ts`
- `ListComputedOutboxQueueJobsQuery.ts` / `ListComputedOutboxQueueJobsHandler.ts`
- `ListComputedOutboxPausesQuery.ts` / `ListComputedOutboxPausesHandler.ts`
- `SearchComputedOutboxPauseSpacesQuery.ts` / `SearchComputedOutboxPauseSpacesHandler.ts`
- `ListComputedOutboxAnomaliesQuery.ts` / `ListComputedOutboxAnomaliesHandler.ts`
- `GetComputedOutboxTaskLineageQuery.ts` / `GetComputedOutboxTaskLineageHandler.ts`
