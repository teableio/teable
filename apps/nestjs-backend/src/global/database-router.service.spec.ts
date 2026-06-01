import { describe, expect, it, vi } from 'vitest';
import { DatabaseRouter } from './database-router.service';

describe('DatabaseRouter', () => {
  it('executes table scoped raw queries through the scoped table client', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ count: 1 }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue({
        txClient: () => ({
          $queryRawUnsafe: queryRaw,
          $executeRawUnsafe: executeRaw,
        }),
      }),
    };
    const router = new DatabaseRouter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataDbClientManager as never
    );

    await expect(router.queryDataPrismaForTable('tblxxx', 'select 1')).resolves.toEqual([
      { count: 1 },
    ]);
    await expect(router.executeDataPrismaForTable('tblxxx', 'update x')).resolves.toBe(1);
    expect(dataDbClientManager.dataPrismaForTable).toHaveBeenCalledWith('tblxxx', undefined);
    expect(queryRaw).toHaveBeenCalledWith('select 1');
    expect(executeRaw).toHaveBeenCalledWith('update x');
  });

  it('passes explicit routing options separately from raw query values', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 'recxxx' }]);
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue({
        txClient: () => ({
          $queryRawUnsafe: queryRaw,
          $executeRawUnsafe: vi.fn(),
        }),
      }),
    };
    const router = new DatabaseRouter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataDbClientManager as never
    );

    await router.queryDataPrismaForTable(
      'tblxxx',
      'select * from x where id = $1',
      { useTransaction: true },
      'recxxx'
    );

    expect(dataDbClientManager.dataPrismaForTable).toHaveBeenCalledWith('tblxxx', {
      useTransaction: true,
    });
    expect(queryRaw).toHaveBeenCalledWith('select * from x where id = $1', 'recxxx');
  });

  it('clears cached query plans and retries once after schema result type changes', async () => {
    const cachedPlanError = {
      code: 'P2010',
      meta: {
        code: '0A000',
        message: 'ERROR: cached plan must not change result type',
      },
    };
    const queryRaw = vi
      .fn()
      .mockRejectedValueOnce(cachedPlanError)
      .mockResolvedValueOnce([{ id: 'recxxx' }]);
    const executeRaw = vi.fn().mockResolvedValue(0);
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue({
        txClient: () => ({
          $queryRawUnsafe: queryRaw,
          $executeRawUnsafe: executeRaw,
        }),
      }),
    };
    const router = new DatabaseRouter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataDbClientManager as never
    );

    await expect(router.queryDataPrismaForTable('tblxxx', 'select * from x')).resolves.toEqual([
      { id: 'recxxx' },
    ]);
    expect(executeRaw).toHaveBeenCalledWith('DISCARD PLANS');
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('does not clear cached query plans while using an explicit transaction client', async () => {
    const cachedPlanError = {
      code: 'P2010',
      meta: {
        code: '0A000',
        message: 'ERROR: cached plan must not change result type',
      },
    };
    const queryRaw = vi.fn().mockRejectedValue(cachedPlanError);
    const executeRaw = vi.fn();
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue({
        txClient: () => ({
          $queryRawUnsafe: queryRaw,
          $executeRawUnsafe: executeRaw,
        }),
      }),
    };
    const router = new DatabaseRouter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataDbClientManager as never
    );

    await expect(
      router.queryDataPrismaForTable('tblxxx', 'select * from x', { useTransaction: true })
    ).rejects.toBe(cachedPlanError);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('executes table scoped transactions with PrismaClient transaction fallback', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const transaction = vi.fn(async (fn) => await fn({ $executeRawUnsafe: executeRaw }));
    const dataDbClientManager = {
      dataPrismaForTable: vi.fn().mockResolvedValue({
        $executeRawUnsafe: vi.fn(),
        $queryRawUnsafe: vi.fn(),
        $transaction: transaction,
      }),
    };
    const router = new DatabaseRouter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataDbClientManager as never
    );

    await router.dataPrismaTransactionForTable('tblxxx', async (prisma) => {
      await prisma.$executeRawUnsafe('alter table x');
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledWith('alter table x');
  });
});
