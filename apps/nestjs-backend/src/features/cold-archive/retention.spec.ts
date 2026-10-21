import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expireColdMonths,
  isColdMonthExpired,
  readColdExpiryDryRun,
  readColdRetentionDays,
} from './retention';

const NOW = new Date('2026-10-19T00:00:00.000Z');

describe('isColdMonthExpired', () => {
  it('never expires with retention 0', () => {
    expect(isColdMonthExpired('200001', 0, NOW)).toBe(false);
  });

  it('expires a month only once its END is older than the retention', () => {
    // 202509 ends 2025-10-01; 365 days before NOW is 2025-10-19
    expect(isColdMonthExpired('202509', 365, NOW)).toBe(true);
    // 202510 ends 2025-11-01, still inside the year
    expect(isColdMonthExpired('202510', 365, NOW)).toBe(false);
  });

  it('treats the month end boundary as expired', () => {
    // 202609 ends 2026-10-01, exactly 18 days before NOW
    expect(isColdMonthExpired('202609', 18, NOW)).toBe(true);
    expect(isColdMonthExpired('202609', 19, NOW)).toBe(false);
  });

  it('rolls December into the next year', () => {
    // 202312 ends 2024-01-01; 1095 days before NOW is 2023-10-20
    expect(isColdMonthExpired('202312', 1095, NOW)).toBe(false);
    expect(isColdMonthExpired('202309', 1095, NOW)).toBe(true);
  });

  it('never expires the current month or a malformed name', () => {
    expect(isColdMonthExpired('202610', 1, NOW)).toBe(false);
    expect(isColdMonthExpired('2026-1', 1, NOW)).toBe(false);
  });
});

describe('retention env', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to 0 days and no dry run', () => {
    vi.stubEnv('BACKEND_TEST_COLD_RETENTION_DAYS', undefined);
    vi.stubEnv('BACKEND_COLD_ARCHIVE_EXPIRY_DRY_RUN', undefined);
    expect(readColdRetentionDays('BACKEND_TEST_COLD_RETENTION_DAYS')).toBe(0);
    expect(readColdExpiryDryRun()).toBe(false);
  });

  it('reads the days, and the cold kill switch turns expiry off', () => {
    vi.stubEnv('BACKEND_TEST_COLD_RETENTION_DAYS', '365');
    expect(readColdRetentionDays('BACKEND_TEST_COLD_RETENTION_DAYS')).toBe(365);
    vi.stubEnv('BACKEND_STORAGE_COLD_ARCHIVE_DISABLED', 'true');
    expect(readColdRetentionDays('BACKEND_TEST_COLD_RETENTION_DAYS')).toBe(0);
  });
});

describe('expireColdMonths', () => {
  const part = (yyyymm: string, n: number, size = 10) => ({
    key: `root/tbl/${yyyymm}/m-p${n}.ndjson.zst`,
    size,
  });
  const partsByMonth = new Map([
    ['202610', [part('202610', 0)]],
    ['202510', [part('202510', 0)]],
    ['202509', [part('202509', 0, 5), part('202509', 1, 7)]],
    ['202401', [part('202401', 0)]],
  ]);

  const run = (dryRun: boolean) => {
    const log = vi.fn();
    const dropFromStats = vi.fn(async (_keys: string[]) => undefined);
    const deleteMonth = vi.fn(async (_yyyymm: string, _keys: string[]) => undefined);
    const result = expireColdMonths({
      category: 'record-history',
      scope: 'tblA',
      partsByMonth,
      retentionDays: 365,
      dryRun,
      logger: { log },
      now: NOW,
      dropFromStats,
      deleteMonth,
    });
    return { result, log, dropFromStats, deleteMonth };
  };

  it('drops the expired parts from stats, deletes each month and logs it', async () => {
    const { result, log, dropFromStats, deleteMonth } = run(false);
    expect([...(await result)]).toEqual(['202509', '202401']);
    expect(dropFromStats).toHaveBeenCalledOnce();
    expect(dropFromStats).toHaveBeenCalledWith([
      'root/tbl/202509/m-p0.ndjson.zst',
      'root/tbl/202509/m-p1.ndjson.zst',
      'root/tbl/202401/m-p0.ndjson.zst',
    ]);
    expect(deleteMonth.mock.calls).toEqual([
      ['202509', ['root/tbl/202509/m-p0.ndjson.zst', 'root/tbl/202509/m-p1.ndjson.zst']],
      ['202401', ['root/tbl/202401/m-p0.ndjson.zst']],
    ]);
    expect(log).toHaveBeenCalledWith(
      'cold archive expiry: category=record-history scope=tblA month=202509 objects=2 bytes=12 retentionDays=365 dryRun=false'
    );
    expect(dropFromStats.mock.invocationCallOrder[0]).toBeLessThan(
      deleteMonth.mock.invocationCallOrder[0]
    );
  });

  it('only logs on a dry run and keeps every month for compaction', async () => {
    const { result, log, dropFromStats, deleteMonth } = run(true);
    expect((await result).size).toBe(0);
    expect(dropFromStats).not.toHaveBeenCalled();
    expect(deleteMonth).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain('month=202509 objects=2 bytes=12');
    expect(log.mock.calls[0][0]).toContain('dryRun=true');
  });

  it('does nothing with retention 0', async () => {
    const deleteMonth = vi.fn();
    const expired = await expireColdMonths({
      category: 'audit-log',
      scope: 'instance',
      partsByMonth,
      retentionDays: 0,
      dryRun: false,
      logger: { log: vi.fn() },
      now: NOW,
      deleteMonth,
    });
    expect(expired.size).toBe(0);
    expect(deleteMonth).not.toHaveBeenCalled();
  });
});
