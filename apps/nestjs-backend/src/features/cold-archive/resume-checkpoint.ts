/**
 * Prefix-resume for a bucket larger than one flush run's budget: without it,
 * the bucket-granular coverage check (id-digest / count all-or-nothing) makes
 * every hop restart the bucket from scratch, get cut at the same budget line,
 * and heal the previous hop's parts — a livelock that also starves every other
 * backlog sharing the run budget.
 *
 * The persisted parts of a partially archived bucket CONTAIN every PG row at
 * or below the checkpoint's boundary: fold-back merges never drop a row, and
 * the run that wrote the checkpoint streamed exactly that prefix into the
 * live parts. Resuming past the boundary lets each hop advance by a full
 * budget even when one bucket exceeds it. The grant is only ever an
 * optimization: any validation failure degrades to the full fold-back
 * re-stream, never to a wrong archive.
 */

import type { IBucketStatsAgg } from './bucket-coverage';

/** exact (created_time, id) position inside a bucket's ascending stream */
export interface IRowBoundaryKey {
  createdTime: string;
  id: string;
}

/**
 * In-flight catch-up state of one bucket: rows at or below `boundary` are
 * archived but still buffered in PG (`pendingRows` of them). agg totals
 * cannot express this — they also count generations whose rows were already
 * deleted. Dropped once the bucket's pending rows are deleted; a stale
 * checkpoint degrades safely (validation fails → full fold-back re-stream).
 */
export interface IResumeCheckpoint {
  boundary: IRowBoundaryKey;
  pendingRows: number;
}

/** a validated resume: stream past `afterKey`, count `prefixRows` as covered */
export interface IResumeGrant {
  afterKey: IRowBoundaryKey;
  prefixRows: number;
}

/**
 * Decide whether a bucket that failed full coverage may resume past its
 * persisted prefix instead of fold-back re-streaming.
 *
 * A zero count at the parts' max key means every archived row was already
 * deleted — the buffer holds only new rows, safe to append. A non-zero count
 * is validated against the bucket's catch-up CHECKPOINT, never against
 * `agg.rows`: the agg total also counts generations whose rows left PG long
 * ago, so comparing to it wedges a bucket that mixes committed history with
 * an over-budget new cohort.
 *
 * The checkpoint's boundary may TRAIL the parts' max key: a budget cut inside
 * a fold-back merge leaves parts extending past the streamed frontier (the
 * merge folds every old-generation row back in). Containment still holds, so
 * the prefix is validated at the checkpoint's OWN boundary and the stream
 * resumes there; rows past it may already sit in an older generation,
 * absorbed by read-side id-dedup and the compactor. This is what keeps a
 * fold-back repair budget-bounded: it may cut on any batch and the rewritten
 * checkpoint carries the repair frontier to the next hop.
 *
 * Any mismatch (straggler inside the prefix, stale or clobbered checkpoint)
 * falls back to the full fold-back re-stream. `countPrefixRows` is the
 * subsystem's own `<= boundary` count inside the bucket range; it is only
 * invoked once the cheap listing identity check passes, and should stay a
 * single cheap aggregate — expensive identity proofs (digest scans over the
 * prefix) belong after the grant.
 */
export const resolveResumeCheckpoint = async (input: {
  agg: IBucketStatsAgg | undefined;
  listed: Set<string> | undefined;
  checkpoint: IResumeCheckpoint | undefined;
  countPrefixRows: (boundary: IRowBoundaryKey) => Promise<number>;
}): Promise<IResumeGrant | undefined> => {
  const { agg, listed, checkpoint, countPrefixRows } = input;
  if (!agg?.maxRow || !listed) return undefined;
  if (agg.keys.size !== listed.size || ![...agg.keys].every((key) => listed.has(key))) {
    return undefined;
  }
  const rowsAtMax = await countPrefixRows(agg.maxRow);
  if (rowsAtMax === 0) return { afterKey: agg.maxRow, prefixRows: 0 };
  if (!checkpoint) return undefined;
  if (
    checkpoint.boundary.createdTime === agg.maxRow.createdTime &&
    checkpoint.boundary.id === agg.maxRow.id
  ) {
    return checkpoint.pendingRows === rowsAtMax
      ? { afterKey: agg.maxRow, prefixRows: rowsAtMax }
      : undefined;
  }
  const rowsAtBoundary = await countPrefixRows(checkpoint.boundary);
  return rowsAtBoundary === checkpoint.pendingRows
    ? { afterKey: checkpoint.boundary, prefixRows: rowsAtBoundary }
    : undefined;
};

/**
 * Checkpoints to persist after a flush: per streamed bucket, the archived
 * rows still buffered in PG — the validated carried prefix (resumed buckets)
 * plus this run's own ascending stream, whose last pushed key is the bucket's
 * archived maximum.
 */
export const buildResumeCheckpoints = (
  streamedByBucket: Map<string, { rows: number; lastKey: IRowBoundaryKey }>,
  carriedPrefixRows: Map<string, number>
): Map<string, IResumeCheckpoint> => {
  const checkpoints = new Map<string, IResumeCheckpoint>();
  for (const [id, tracked] of streamedByBucket) {
    const carried = carriedPrefixRows.get(id) ?? 0;
    checkpoints.set(id, { boundary: tracked.lastKey, pendingRows: carried + tracked.rows });
  }
  return checkpoints;
};
