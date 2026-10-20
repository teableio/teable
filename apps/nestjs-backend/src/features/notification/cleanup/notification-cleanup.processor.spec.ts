import type { PrismaService } from '@teable/db-main-prisma';
import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationCleanupProcessor } from './notification-cleanup.processor';

const NOW = new Date('2026-10-19T00:00:00.000Z');

const setup = (batches: string[][]) => {
  const findMany = vi.fn();
  for (const ids of batches) findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
  findMany.mockResolvedValue([]);
  const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
    count: where.id.in.length,
  }));
  const upsertJobScheduler = vi.fn();
  const prisma = { notification: { findMany, deleteMany } } as unknown as PrismaService;
  const queue = { upsertJobScheduler } as unknown as Queue;
  return {
    processor: new NotificationCleanupProcessor(prisma, queue),
    findMany,
    deleteMany,
    upsertJobScheduler,
  };
};

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('NotificationCleanupProcessor', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default: no scheduler and no deletes', async () => {
    vi.stubEnv('BACKEND_NOTIFICATION_RETENTION_DAYS', undefined);
    const { processor, findMany, upsertJobScheduler } = setup([['a']]);
    await processor.onModuleInit();
    expect(upsertJobScheduler).not.toHaveBeenCalled();
    expect(await processor.cleanupExpired(NOW)).toEqual({ deleted: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('registers a daily scheduler when retention is set', async () => {
    vi.stubEnv('BACKEND_NOTIFICATION_RETENTION_DAYS', '180');
    const { processor, upsertJobScheduler } = setup([]);
    await processor.onModuleInit();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'notification:cleanup',
      { every: 24 * 60 * 60 * 1000 },
      { name: 'notification:cleanup' }
    );
  });

  it('deletes rows older than the cutoff in batches until a short batch', async () => {
    vi.stubEnv('BACKEND_NOTIFICATION_RETENTION_DAYS', '180');
    const { processor, findMany, deleteMany } = setup([ids('a', 1000), ids('b', 3)]);
    const result = await processor.cleanupExpired(NOW);

    const cutoff = new Date('2026-04-22T00:00:00.000Z');
    expect(result).toEqual({ deleted: 1003, cutoff: cutoff.toISOString() });
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdTime: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdTime: 'asc' },
      take: 1000,
    });
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenLastCalledWith({ where: { id: { in: ids('b', 3) } } });
  });

  it('stops when nothing is left', async () => {
    vi.stubEnv('BACKEND_NOTIFICATION_RETENTION_DAYS', '180');
    const { processor, deleteMany } = setup([]);
    expect((await processor.cleanupExpired(NOW)).deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
