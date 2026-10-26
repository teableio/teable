import type { IUpsertRecordsRo } from '@teable/openapi';

/**
 * Actions an upsert request must hold before it may touch the database.
 *
 * `error` only inserts, so create is enough. `ignore` and `update` also write
 * matched rows, which is an update of existing data and therefore needs both.
 */
export const upsertRequiredPermissions = (
  onConflict: IUpsertRecordsRo['onConflict']
): ReadonlyArray<'record|create' | 'record|update'> =>
  onConflict === 'error' ? ['record|create'] : ['record|create', 'record|update'];

/**
 * Rows to reserve against the space MaxRows limit before an upsert runs.
 *
 * `error` inserts every row, so the request count is exact. `ignore`/`update`
 * only insert unmatched rows and update the rest, so reserving the request count
 * would bill pure updates as creates; those rows are metered by the create events
 * the write pipeline emits.
 */
export const upsertUsageIncrement = (
  onConflict: IUpsertRecordsRo['onConflict'],
  recordCount: number
): number | undefined => (onConflict === 'error' ? recordCount : undefined);
