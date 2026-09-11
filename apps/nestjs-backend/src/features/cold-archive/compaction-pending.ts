import ms from 'ms';
import type { RedisNativeService } from '../../cache/redis-native.service';
import { CompactionSkipReason } from './compaction';
import { readPositiveIntEnv } from './env';

// Pending-id set shared by the cold compactors: the flusher marks a table (or
// workflow) whenever it writes day parts, and the monthly compaction walks only
// marked ids instead of every prefix in the bucket. Members are claimed with
// SREM before the merge, so a job redelivered to a second pod skips what the
// first one already took and resumes from the unclaimed remainder.
//
// The set is only authoritative after one full scan has run against it: a
// `<key>:bootstrapped` marker records that. It lives in the same redis, so a
// flushed redis loses both and the next run scans everything again; deleting
// the marker by hand forces a full scan on the next run. The marker also
// expires (FULL_SCAN_INTERVAL): an id that fell out of the set without being
// compacted (a pod dying after its claim, a failed mark) is only ever found
// by a full walk, so one runs at least that often.

export enum CompactionScanMode {
  Pending = 'pending',
  Full = 'full',
}

export interface ICompactionPendingSet {
  redis: Pick<
    RedisNativeService,
    'available' | 'sadd' | 'srem' | 'sscan' | 'exists' | 'setex' | 'del' | 'expire'
  >;
  key: string;
  /** log prefix naming the subsystem, e.g. `record-history` */
  subsystem: string;
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export interface ICompactionScanResult<TResult> {
  mode: CompactionScanMode;
  /** members read from the pending set; 0 without redis or when it was unreadable */
  pending: number;
  /** ids the run attempted (a full listing, or the pending members) */
  candidates: number;
  /** ids put back because a month of theirs is still open */
  deferred: number;
  results: TResult[];
}

export const compactionBootstrappedKey = (key: string): string => `${key}:bootstrapped`;

/**
 * how long a full scan keeps the pending set authoritative before the next
 * one; below the monthly cron gap, so every scheduled run is a full scan and
 * an id that left the set uncompacted waits one month at most
 */
export const compactionFullScanIntervalMs = (): number =>
  readPositiveIntEnv('BACKEND_STORAGE_COLD_COMPACT_FULL_SCAN_INTERVAL_MS', ms('20d'));

/**
 * how long the pending set outlives its last write; well above the monthly
 * cron gap so it is consumed before it expires, and a set that expired
 * (nothing written for that long) makes the next run a full scan
 */
export const compactionPendingTtlMs = (): number =>
  readPositiveIntEnv('BACKEND_STORAGE_COLD_COMPACT_PENDING_TTL_MS', ms('45d'));

/** SADD plus a refreshed TTL: every write keeps the set alive a little longer */
const addPending = async (redis: ICompactionPendingSet['redis'], key: string, id: string) => {
  await redis.sadd(key, id);
  await redis.expire(key, Math.ceil(compactionPendingTtlMs() / 1000));
};

/**
 * whether a flush run wrote at least one part: day parts are what a month
 * compaction merges, and a month part written next to another generation
 * (a flush that died before healing) is what it converges
 */
export const wroteAnyPart = (touched: Iterable<{ writtenKeys: Set<string> }>): boolean => {
  for (const { writtenKeys } of touched) {
    if (writtenKeys.size > 0) return true;
  }
  return false;
};

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const SSCAN_PAGE = 500;

/** every member of the set, read page by page so no single command is O(N) */
const readMembers = async (redis: ICompactionPendingSet['redis'], key: string) => {
  const members = new Set<string>();
  let cursor = '0';
  do {
    const [next, page] = await redis.sscan(key, cursor, SSCAN_PAGE);
    for (const member of page) members.add(member);
    cursor = next;
  } while (cursor !== '0');
  return [...members];
};

/**
 * Flusher side. A failed mark must not fail the flush: the id is then picked
 * up by the next flush that touches it, or by the next full scan.
 */
export const markCompactionPending = async (
  options: ICompactionPendingSet & { id: string }
): Promise<void> => {
  const { redis, key, subsystem, logger, id } = options;
  if (!redis.available) return;
  try {
    await addPending(redis, key, id);
  } catch (error) {
    logger.warn(
      `${subsystem} cold flush could not mark ${id} pending for compaction in ${key}: ${describeError(error)}`
    );
  }
};

interface ICandidates {
  mode: CompactionScanMode;
  pending: number;
  ids: string[];
  /** a full scan that ran against a live redis makes the set authoritative */
  bootstraps: boolean;
}

const selectCandidates = async (
  options: ICompactionPendingSet & { listAll: () => Promise<string[]> }
): Promise<ICandidates> => {
  const { redis, key, subsystem, logger, listAll } = options;
  // a full scan also takes the members the listing no longer has (a table
  // deleted after its last flush), so they get claimed and leave the set
  const fullScan = async (
    why: string,
    bootstraps: boolean,
    members: string[] = []
  ): Promise<ICandidates> => {
    logger.log(`${subsystem} cold compaction: full scan (${why})`);
    const ids = [...new Set([...(await listAll()), ...members])].sort();
    return { mode: CompactionScanMode.Full, pending: members.length, ids, bootstraps };
  };
  if (!redis.available) return fullScan('redis unavailable', false);
  let members: string[];
  let bootstrapped: boolean;
  let present: boolean;
  try {
    bootstrapped = await redis.exists(compactionBootstrappedKey(key));
    present = await redis.exists(key);
    members = present ? await readMembers(redis, key) : [];
  } catch (error) {
    return fullScan(`pending set ${key} unreadable: ${describeError(error)}`, false);
  }
  if (!bootstrapped) {
    return fullScan('pending set not bootstrapped or its marker expired', true, members);
  }
  // redis drops an empty set, so "nothing pending" and "the set expired or
  // was lost" look the same; both walk everything rather than trust a blank
  if (!present) return fullScan('pending set missing', false);
  return {
    mode: CompactionScanMode.Pending,
    pending: members.length,
    ids: members.sort(),
    bootstraps: false,
  };
};

/** SREM first: 0 removed means another pod already holds this id */
const claimPending = async (options: ICompactionPendingSet, id: string): Promise<boolean> => {
  const { redis, key, subsystem, logger } = options;
  try {
    return (await redis.srem(key, id)) > 0;
  } catch (error) {
    logger.warn(
      `${subsystem} cold compaction could not claim ${id} from ${key}, leaving it for the next run: ${describeError(error)}`
    );
    return false;
  }
};

/** returns whether the command went through; a miss is logged, never thrown */
const updatePendingSet = async (
  options: ICompactionPendingSet,
  what: string,
  command: () => Promise<unknown>
): Promise<boolean> => {
  const { redis, key, subsystem, logger } = options;
  if (!redis.available) return false;
  try {
    await command();
    return true;
  } catch (error) {
    logger.warn(
      `${subsystem} cold compaction could not ${what} in ${key}: ${describeError(error)}`
    );
    return false;
  }
};

/**
 * Compactor side: pick the candidates (pending members, or every id until the
 * set is bootstrapped and its marker not yet expired / without redis), take
 * each id out of the set BEFORE
 * compacting it (so a mark the flusher adds meanwhile survives), compact, and
 * put the id back when the merge failed or one of its months is still open.
 * The bootstrapped marker is written once a full walk completes with every
 * put-back in place; a put-back that failed, in any mode, removes the marker
 * so the next run walks everything again instead of trusting an incomplete
 * set.
 */
export const runCompactionScan = async <TResult extends { skippedReason?: string }>(
  options: ICompactionPendingSet & {
    listAll: () => Promise<string[]>;
    compact: (id: string) => Promise<TResult[]>;
  }
): Promise<ICompactionScanResult<TResult>> => {
  const { mode, pending, ids, bootstraps } = await selectCandidates(options);
  const results: TResult[] = [];
  let deferred = 0;
  let putBackFailed = false;
  for (const id of ids) {
    if (!(await takeCandidate(options, mode, id))) continue;
    const outcome = await compactCandidate(options, id);
    results.push(...outcome.results);
    if (outcome.deferred) deferred += 1;
    if (outcome.putBackFailed) putBackFailed = true;
  }
  await settleMarker(options, { bootstraps, putBackFailed });
  return { mode, pending, candidates: ids.length, deferred, results };
};

/** pending mode needs the claim; a full scan only clears the id so a fresh mark survives */
const takeCandidate = async (
  options: ICompactionPendingSet,
  mode: CompactionScanMode,
  id: string
): Promise<boolean> => {
  const { redis, key } = options;
  if (mode === CompactionScanMode.Pending) return claimPending(options, id);
  await updatePendingSet(options, `take ${id} before its full-scan compaction`, () =>
    redis.srem(key, id)
  );
  return true;
};

const compactCandidate = async <TResult extends { skippedReason?: string }>(
  options: ICompactionPendingSet & { compact: (id: string) => Promise<TResult[]> },
  id: string
): Promise<{ results: TResult[]; deferred: boolean; putBackFailed: boolean }> => {
  const { redis, key, logger, subsystem, compact } = options;
  let results: TResult[];
  try {
    results = await compact(id);
  } catch (error) {
    logger.error(
      `${subsystem} compaction failed for ${id}: ${error instanceof Error ? error.stack : error}`
    );
    const putBack = await updatePendingSet(options, `put back failed ${id}`, () =>
      addPending(redis, key, id)
    );
    return { results: [], deferred: false, putBackFailed: !putBack };
  }
  const deferred = results.some(
    (result) => result.skippedReason === CompactionSkipReason.OpenMonth
  );
  if (!deferred) return { results, deferred, putBackFailed: false };
  const kept = await updatePendingSet(options, `keep ${id} pending for its open month`, () =>
    addPending(redis, key, id)
  );
  return { results, deferred, putBackFailed: !kept };
};

const settleMarker = async (
  options: ICompactionPendingSet,
  outcome: { bootstraps: boolean; putBackFailed: boolean }
): Promise<void> => {
  const { redis, key, logger, subsystem } = options;
  const marker = compactionBootstrappedKey(key);
  if (outcome.putBackFailed) {
    logger.warn(
      `${subsystem} cold compaction: a put-back failed, so the pending set is incomplete; removing ${marker} to make the next run a full scan`
    );
    await updatePendingSet(options, `remove ${marker}`, () => redis.del(marker));
    return;
  }
  if (!outcome.bootstraps) return;
  await updatePendingSet(options, 'mark the pending set bootstrapped', () =>
    redis.setex(
      compactionBootstrappedKey(key),
      Math.ceil(compactionFullScanIntervalMs() / 1000),
      new Date().toISOString()
    )
  );
};
