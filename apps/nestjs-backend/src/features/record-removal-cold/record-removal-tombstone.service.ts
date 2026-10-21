import { Injectable } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import type { PrismaClient } from '@teable/db-data-prisma';

// True-deletion markers for record_trash rows already sunk to cold parts: S3
// parts are immutable, so restoring or purging a sunk row cannot remove its
// cold copy in place — a tombstone suppresses it instead (cold reads and the
// restore fallback filter through the set; monthly compaction physically
// drops tombstoned rows when it rewrites month parts). Callers mark EVERY
// restore/purge of a removed row — archive AND trash restores alike — not just
// cold-fetched rows: a PG buffer row cannot tell whether it already sits in
// the flush overlap window (uploaded, not yet drained), and a marker for a
// never-sunk row is harmless. Markers are reason-agnostic by design: a record
// is in at most one removed state at a time, so a restore marker always
// predates the record's NEXT removal and the time-qualified check below never
// suppresses that newer row, whatever its reason.

export const RECORD_REMOVAL_TOMBSTONE_TYPES = ['restored', 'purged'] as const;

export type RecordRemovalTombstoneType = (typeof RECORD_REMOVAL_TOMBSTONE_TYPES)[number];

const TOMBSTONE_ID_PREFIX = 'rmt';

export const generateRecordRemovalTombstoneId = () => TOMBSTONE_ID_PREFIX + getRandomString(16);

// recordId -> latest tombstone createdTime (canonical ISO string). The time
// qualifies the suppression: a tombstone only hides cold rows REMOVED BEFORE
// it was written. A record restored from cold and archived again later sinks a
// NEW row with removedTime after the tombstone — that row is live data and
// must neither be hidden from cold reads nor dropped by compaction, so a bare
// recordId set would be unsound.
export type IRemovalTombstoneMap = Map<string, string>;

export const isTombstonedAt = (
  tombstones: IRemovalTombstoneMap,
  recordId: string,
  removedTime: string
): boolean => {
  const tombstonedAt = tombstones.get(recordId);
  return tombstonedAt !== undefined && removedTime <= tombstonedAt;
};

// the tombstone table lives in each table's DATA db (same db as record_trash),
// so every method takes the table-scoped client the caller already routed —
// mirroring how the flusher/archive service obtain theirs via
// DataDbClientManager. The minimal Pick also accepts a transaction client.
type ITombstoneDbClient = Pick<PrismaClient, 'recordRemovalTombstone'>;

@Injectable()
export class RecordRemovalTombstoneService {
  async markRestored(
    dataPrisma: ITombstoneDbClient,
    tableId: string,
    recordIds: string[]
  ): Promise<void> {
    await this.mark(dataPrisma, tableId, recordIds, 'restored');
  }

  async markPurged(
    dataPrisma: ITombstoneDbClient,
    tableId: string,
    recordIds: string[]
  ): Promise<void> {
    await this.mark(dataPrisma, tableId, recordIds, 'purged');
  }

  private async mark(
    dataPrisma: ITombstoneDbClient,
    tableId: string,
    recordIds: string[],
    type: RecordRemovalTombstoneType
  ): Promise<void> {
    if (recordIds.length === 0) return;
    // App clock, not the column's db-side now() default: the suppression compares
    // this against removedTime, which is stamped from the app clock at archive time
    // (buildRecordTrashRows) — same clock source keeps the <= comparison from
    // inverting on app-vs-db clock skew.
    const createdTime = new Date();
    await dataPrisma.recordRemovalTombstone.createMany({
      data: recordIds.map((recordId) => ({
        id: generateRecordRemovalTombstoneId(),
        tableId,
        recordId,
        type,
        createdTime,
      })),
    });
  }

  // Whole-table load, no pagination: tombstones accumulate one row per
  // restored/purged record (never from archive/delete creation traffic, and
  // reset paths wipe the cold prefix instead of marking), so the per-table set
  // stays bounded by user-driven restore/purge volume — one indexed query per
  // cold fill is cheaper than plumbing per-row lookups through the reader.
  // Bulk trash restores can mark tens of thousands of ids at once; if a table's
  // set ever grows past what one load comfortably holds, compaction-side
  // cleanup of markers older than every remaining part is the relief valve.
  async loadTombstonedRecordIds(
    dataPrisma: ITombstoneDbClient,
    tableId: string
  ): Promise<IRemovalTombstoneMap> {
    const rows = await dataPrisma.recordRemovalTombstone.findMany({
      where: { tableId },
      select: { recordId: true, createdTime: true },
    });
    const tombstones: IRemovalTombstoneMap = new Map();
    for (const row of rows) {
      const createdTime = row.createdTime.toISOString();
      const existing = tombstones.get(row.recordId);
      if (existing === undefined || existing < createdTime) {
        tombstones.set(row.recordId, createdTime);
      }
    }
    return tombstones;
  }
}
