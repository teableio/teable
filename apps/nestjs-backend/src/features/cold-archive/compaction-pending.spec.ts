import { describe, expect, it } from 'vitest';
import { CompactionSkipReason } from './compaction';
import {
  CompactionScanMode,
  compactionBootstrappedKey,
  markCompactionPending,
  runCompactionScan,
  wroteAnyPart,
} from './compaction-pending';
import { FakePendingRedis } from './compaction-pending.spec-fixtures';

const KEY = 'test-cold:compact-pending';

interface IScanResult {
  id: string;
  skippedReason?: string;
}
const bootstrapped = (redis: FakePendingRedis) =>
  redis.setex(compactionBootstrappedKey(KEY), 1, '2026-09-01T00:00:00.000Z');

const makeLogger = () => {
  const lines: { level: string; message: string }[] = [];
  return {
    lines,
    log: (message: string) => lines.push({ level: 'log', message }),
    warn: (message: string) => lines.push({ level: 'warn', message }),
    error: (message: string) => lines.push({ level: 'error', message }),
  };
};

const setFor = (redis: FakePendingRedis, logger = makeLogger()) => ({
  redis,
  key: KEY,
  subsystem: 'test',
  logger,
});

describe('wroteAnyPart', () => {
  it('needs a bucket that actually wrote a key, whatever its kind', () => {
    const emptyMonth = { writtenKeys: new Set<string>() };
    const emptyDay = { writtenKeys: new Set<string>() };
    const month = { writtenKeys: new Set(['m']) };
    expect(wroteAnyPart([])).toBe(false);
    expect(wroteAnyPart([emptyMonth, emptyDay])).toBe(false);
    expect(wroteAnyPart([emptyMonth, month])).toBe(true);
  });
});

describe('markCompactionPending', () => {
  it('refreshes the set TTL on every mark', async () => {
    const redis = new FakePendingRedis();
    await markCompactionPending({ ...setFor(redis), id: 'tblA' });
    expect(redis.members(KEY)).toEqual(['tblA']);
    expect(redis.ttls.get(KEY)).toBe(45 * 24 * 60 * 60);
  });

  it('adds the id to the set', async () => {
    const redis = new FakePendingRedis();
    await markCompactionPending({ ...setFor(redis), id: 'tblA' });
    await markCompactionPending({ ...setFor(redis), id: 'tblA' });
    expect(redis.members(KEY)).toEqual(['tblA']);
  });

  it('is a no-op without redis and survives a failing SADD with a warning', async () => {
    const redis = new FakePendingRedis();
    redis.available = false;
    await markCompactionPending({ ...setFor(redis), id: 'tblA' });
    expect(redis.members(KEY)).toEqual([]);

    redis.available = true;
    redis.failNext = { command: 'sadd', error: new Error('READONLY') };
    const logger = makeLogger();
    await expect(
      markCompactionPending({ ...setFor(redis, logger), id: 'tblA' })
    ).resolves.toBeUndefined();
    expect(logger.lines).toEqual([
      { level: 'warn', message: expect.stringContaining('could not mark tblA pending') },
    ]);
  });
});

describe('runCompactionScan', () => {
  const listAll = async () => ['tblA', 'tblB', 'tblC'];

  it('walks only the pending members once the set is bootstrapped, claiming each one', async () => {
    const redis = new FakePendingRedis();
    await bootstrapped(redis);
    await redis.sadd(KEY, 'tblC', 'tblB');
    const compacted: string[] = [];
    const scan = await runCompactionScan<IScanResult>({
      ...setFor(redis),
      listAll,
      compact: async (id) => {
        compacted.push(id);
        return [{ id }];
      },
    });
    expect(scan).toEqual({
      mode: CompactionScanMode.Pending,
      pending: 2,
      candidates: 2,
      deferred: 0,
      results: [{ id: 'tblB' }, { id: 'tblC' }],
    });
    expect(compacted).toEqual(['tblB', 'tblC']);
    expect(redis.members(KEY)).toEqual([]);
  });

  it('skips a member another pod claimed first', async () => {
    const redis = new FakePendingRedis();
    await bootstrapped(redis);
    await redis.sadd(KEY, 'tblA', 'tblB');
    const compacted: string[] = [];
    await runCompactionScan<IScanResult>({
      ...setFor(redis),
      listAll,
      compact: async (id) => {
        compacted.push(id);
        // the peer pod takes tblB while this one is busy with tblA
        await redis.srem(KEY, 'tblB');
        return [];
      },
    });
    expect(compacted).toEqual(['tblA']);
  });

  it('puts a failed id back and logs the error', async () => {
    const redis = new FakePendingRedis();
    await bootstrapped(redis);
    await redis.sadd(KEY, 'tblA', 'tblB');
    const logger = makeLogger();
    const scan = await runCompactionScan<IScanResult>({
      ...setFor(redis, logger),
      listAll,
      compact: async (id) => {
        if (id === 'tblA') throw new Error('merge died');
        return [{ id }];
      },
    });
    expect(scan.results).toEqual([{ id: 'tblB' }]);
    expect(redis.members(KEY)).toEqual(['tblA']);
    expect(logger.lines).toEqual([
      { level: 'error', message: expect.stringContaining('test compaction failed for tblA') },
    ]);
  });

  it('keeps an id pending when one of its months is still open', async () => {
    const redis = new FakePendingRedis();
    await bootstrapped(redis);
    await redis.sadd(KEY, 'tblA', 'tblB');
    const scan = await runCompactionScan<IScanResult>({
      ...setFor(redis),
      listAll,
      compact: async (id) => [
        { id, skippedReason: id === 'tblA' ? CompactionSkipReason.OpenMonth : undefined },
      ],
    });
    expect(scan).toMatchObject({ mode: CompactionScanMode.Pending, candidates: 2, deferred: 1 });
    expect(redis.members(KEY)).toEqual(['tblA']);
  });

  it('a mark the flusher adds while a full scan compacts that id survives the scan', async () => {
    const redis = new FakePendingRedis();
    await redis.sadd(KEY, 'tblB');
    await runCompactionScan<IScanResult>({
      ...setFor(redis),
      listAll,
      compact: async (id) => {
        // the flusher writes new parts for tblB after this run listed it
        if (id === 'tblB') await redis.sadd(KEY, 'tblB');
        return [{ id }];
      },
    });
    expect(redis.members(KEY)).toEqual(['tblB']);
    expect(redis.strings.has(compactionBootstrappedKey(KEY))).toBe(true);
  });

  it('leaves a member for the next run when its claim cannot be made', async () => {
    const redis = new FakePendingRedis();
    await bootstrapped(redis);
    await redis.sadd(KEY, 'tblA');
    redis.failNext = { command: 'srem', error: new Error('connection lost') };
    const logger = makeLogger();
    const compacted: string[] = [];
    await runCompactionScan<IScanResult>({
      ...setFor(redis, logger),
      listAll,
      compact: async (id) => {
        compacted.push(id);
        return [];
      },
    });
    expect(compacted).toEqual([]);
    expect(redis.members(KEY)).toEqual(['tblA']);
    expect(logger.lines[0]).toEqual({
      level: 'warn',
      message: expect.stringContaining('could not claim tblA'),
    });
  });

  it('scans every id until the set is bootstrapped, clears the compacted ones and marks it', async () => {
    const redis = new FakePendingRedis();
    await redis.sadd(KEY, 'tblB', 'tblZ');
    const logger = makeLogger();
    const scan = await runCompactionScan<IScanResult>({
      ...setFor(redis, logger),
      listAll,
      compact: async (id) => {
        if (id === 'tblC') throw new Error('merge died');
        return [{ id }];
      },
    });
    expect(scan).toMatchObject({ mode: CompactionScanMode.Full, pending: 2, candidates: 4 });
    expect(scan.results).toEqual([{ id: 'tblA' }, { id: 'tblB' }, { id: 'tblZ' }]);
    // tblB compacted → cleared; tblC failed → marked; tblZ is not listed any
    // more (deleted after its last flush) but still gets claimed and leaves
    expect(redis.members(KEY)).toEqual(['tblC']);
    expect(logger.lines[0]).toEqual({
      level: 'log',
      message:
        'test cold compaction: full scan (pending set not bootstrapped or its marker expired)',
    });
    expect(redis.strings.get(compactionBootstrappedKey(KEY))).toEqual(expect.any(String));
    expect(redis.ttls.get(compactionBootstrappedKey(KEY))).toBe(20 * 24 * 60 * 60);
  });

  it('a full scan claims a member whose prefix is gone so it does not linger', async () => {
    const redis = new FakePendingRedis();
    await redis.sadd(KEY, 'tblGone');
    const compacted: string[] = [];
    await runCompactionScan<IScanResult>({
      ...setFor(redis),
      listAll,
      compact: async (id) => {
        compacted.push(id);
        return [];
      },
    });
    expect(compacted).toEqual(['tblA', 'tblB', 'tblC', 'tblGone']);
    expect(redis.members(KEY)).toEqual([]);
  });

  it('does not mark the set bootstrapped when the full scan ran without a usable redis', async () => {
    const unavailable = new FakePendingRedis();
    unavailable.available = false;
    await runCompactionScan<IScanResult>({
      ...setFor(unavailable),
      listAll,
      compact: async (id) => [{ id }],
    });
    expect(unavailable.strings.size).toBe(0);
  });

  it('leaves the marker unset when a put-back failed during the bootstrap scan', async () => {
    const redis = new FakePendingRedis();
    const logger = makeLogger();
    const scan = await runCompactionScan<IScanResult>({
      ...setFor(redis, logger),
      listAll,
      compact: async (id) => {
        if (id === 'tblB') {
          // the put-back of tblB will hit a redis blip
          redis.failNext = { command: 'sadd', error: new Error('connection reset') };
          throw new Error('merge died');
        }
        return [{ id }];
      },
    });
    expect(scan).toMatchObject({ mode: CompactionScanMode.Full, candidates: 3 });
    expect(redis.members(KEY)).toEqual([]);
    expect(redis.strings.has(compactionBootstrappedKey(KEY))).toBe(false);
    expect(logger.lines.at(-1)).toEqual({
      level: 'warn',
      message: expect.stringContaining('removing'),
    });
  });

  it('walks everything when the marker is live but the set is missing', async () => {
    const redis = new FakePendingRedis();
    await bootstrapped(redis);
    const logger = makeLogger();
    const scan = await runCompactionScan<IScanResult>({
      ...setFor(redis, logger),
      listAll,
      compact: async (id) => [{ id }],
    });
    expect(scan).toMatchObject({ mode: CompactionScanMode.Full, pending: 0, candidates: 3 });
    expect(logger.lines[0].message).toBe('test cold compaction: full scan (pending set missing)');
    // a full scan the marker did not ask for leaves the marker as it was
    expect(redis.strings.has(compactionBootstrappedKey(KEY))).toBe(true);
  });

  it('removes a live marker when a put-back fails, so the next run is a full scan', async () => {
    const redis = new FakePendingRedis();
    await bootstrapped(redis);
    await redis.sadd(KEY, 'tblA');
    const scan = await runCompactionScan<IScanResult>({
      ...setFor(redis),
      listAll,
      compact: async (id) => {
        redis.failNext = { command: 'sadd', error: new Error('connection reset') };
        return [{ id, skippedReason: CompactionSkipReason.OpenMonth }];
      },
    });
    expect(scan).toMatchObject({ mode: CompactionScanMode.Pending, deferred: 1 });
    expect(redis.members(KEY)).toEqual([]);
    expect(redis.strings.has(compactionBootstrappedKey(KEY))).toBe(false);
  });

  it('warns when the bootstrapped marker cannot be written', async () => {
    const redis = new FakePendingRedis();
    redis.failNext = { command: 'setex', error: new Error('read only replica') };
    const logger = makeLogger();
    await runCompactionScan<IScanResult>({
      ...setFor(redis, logger),
      listAll,
      compact: async (id) => [{ id }],
    });
    expect(redis.strings.size).toBe(0);
    expect(logger.lines.at(-1)).toEqual({
      level: 'warn',
      message: expect.stringContaining('could not mark the pending set bootstrapped'),
    });
  });

  it('falls back to a full scan without redis or when the set cannot be read', async () => {
    const unavailable = new FakePendingRedis();
    unavailable.available = false;
    const offlineLogger = makeLogger();
    const offline = await runCompactionScan<IScanResult>({
      ...setFor(unavailable, offlineLogger),
      listAll,
      compact: async (id) => [{ id }],
    });
    expect(offline).toMatchObject({ mode: CompactionScanMode.Full, candidates: 3 });
    expect(offlineLogger.lines[0].message).toBe(
      'test cold compaction: full scan (redis unavailable)'
    );

    const flaky = new FakePendingRedis();
    await bootstrapped(flaky);
    await flaky.sadd(KEY, 'tblA');
    flaky.failNext = { command: 'sscan', error: new Error('timeout') };
    const flakyLogger = makeLogger();
    const degraded = await runCompactionScan<IScanResult>({
      ...setFor(flaky, flakyLogger),
      listAll,
      compact: async (id) => [{ id }],
    });
    expect(degraded).toMatchObject({ mode: CompactionScanMode.Full, candidates: 3 });
    expect(flakyLogger.lines[0].message).toBe(
      `test cold compaction: full scan (pending set ${KEY} unreadable: timeout)`
    );
  });
});
