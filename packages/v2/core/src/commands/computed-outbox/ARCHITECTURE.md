Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# commands/computed-outbox Architecture Notes

## Responsibilities

- Public write-side CQRS for computed-update outbox maintenance (pause, resume,
  dead-letter recover/discard, queue cleanup, concurrency overrides).
- Handlers call `IComputedOutboxAdmin`. Host adapters own BullMQ, BYODB inventory,
  and Prisma space lookup.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe outbox command scope.
- `PauseComputedOutboxCommand.ts` / `PauseComputedOutboxHandler.ts`
- `ResumeComputedOutboxCommand.ts` / `ResumeComputedOutboxHandler.ts`
- `RecoverComputedOutboxAnomalyCommand.ts` / `RecoverComputedOutboxAnomalyHandler.ts`
- `RecoverComputedOutboxAnomalyBatchCommand.ts` / `RecoverComputedOutboxAnomalyBatchHandler.ts`
- `DiscardComputedOutboxAnomalyBatchCommand.ts` / `DiscardComputedOutboxAnomalyBatchHandler.ts`
- `CleanComputedOutboxFailedJobsCommand.ts` / `CleanComputedOutboxFailedJobsHandler.ts`
- `UpdateComputedOutboxWorkerConcurrencyCommand.ts` / `UpdateComputedOutboxWorkerConcurrencyHandler.ts`
- `UpdateComputedOutboxClaimConcurrencyCommand.ts` / `UpdateComputedOutboxClaimConcurrencyHandler.ts`
