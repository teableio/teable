import { readBoolEnv, readNonNegativeIntEnv } from './env';

// Month expiry shared by the cold compactors: before a table's (or
// workflow's, or the instance's) months are compacted, whole month folders
// older than the retention period are deleted. Expiry is decided by the month
// folder NAME, never by object timestamps.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * a subsystem's retention in days. 0 (the default) never expires, and the
 * shared cold kill switch turns expiry off like the rest of the migration
 */
export const readColdRetentionDays = (name: string): number =>
  readBoolEnv('BACKEND_STORAGE_COLD_ARCHIVE_DISABLED') ? 0 : readNonNegativeIntEnv(name, 0);

/** one switch for every subsystem: log what would be deleted, delete nothing */
export const readColdExpiryDryRun = (): boolean =>
  readBoolEnv('BACKEND_COLD_ARCHIVE_EXPIRY_DRY_RUN');

/**
 * a month expires once its END (the first instant of the next month, UTC) is
 * at least `retentionDays` in the past, so every row in it is older than the
 * retention period
 */
export const isColdMonthExpired = (yyyymm: string, retentionDays: number, now: Date): boolean => {
  if (retentionDays <= 0 || !/^\d{6}$/.test(yyyymm)) return false;
  const monthEnd = Date.UTC(Number(yyyymm.slice(0, 4)), Number(yyyymm.slice(4, 6)), 1);
  return monthEnd <= now.getTime() - retentionDays * DAY_MS;
};

export interface IExpireColdMonthsOptions<TPart extends { key: string; size: number }> {
  /** e.g. `record-history`; goes into the log line */
  category: string;
  /** table / workflow id, or `instance` for the audit log */
  scope: string;
  partsByMonth: Map<string, TPart[]>;
  retentionDays: number;
  dryRun: boolean;
  logger: { log: (message: string) => void };
  now?: Date;
  /** drop the expired parts from the stats shard; runs before any object is deleted */
  dropFromStats?: (keys: string[]) => Promise<void>;
  /** delete one expired month's objects */
  deleteMonth: (yyyymm: string, keys: string[]) => Promise<void>;
}

/**
 * Deletes the expired months of one scope and returns them, so the caller
 * skips them in the compaction that follows. A dry run only logs and returns
 * nothing. Stats go first (a part without a stats entry is just scanned), the
 * objects after; a failure part-way leaves the rest for the next run.
 */
export const expireColdMonths = async <TPart extends { key: string; size: number }>(
  options: IExpireColdMonthsOptions<TPart>
): Promise<Set<string>> => {
  const { category, scope, partsByMonth, retentionDays, dryRun, logger } = options;
  const now = options.now ?? new Date();
  const expired = [...partsByMonth].filter(([yyyymm]) =>
    isColdMonthExpired(yyyymm, retentionDays, now)
  );
  const logMonth = (yyyymm: string, parts: TPart[]) =>
    logger.log(
      `cold archive expiry: category=${category} scope=${scope} month=${yyyymm} ` +
        `objects=${parts.length} bytes=${parts.reduce((sum, part) => sum + part.size, 0)} ` +
        `retentionDays=${retentionDays} dryRun=${dryRun}`
    );
  if (expired.length === 0) return new Set();
  if (dryRun) {
    for (const [yyyymm, parts] of expired) logMonth(yyyymm, parts);
    return new Set();
  }
  await options.dropFromStats?.(expired.flatMap(([, parts]) => parts.map((part) => part.key)));
  for (const [yyyymm, parts] of expired) {
    await options.deleteMonth(
      yyyymm,
      parts.map((part) => part.key)
    );
    logMonth(yyyymm, parts);
  }
  return new Set(expired.map(([yyyymm]) => yyyymm));
};
