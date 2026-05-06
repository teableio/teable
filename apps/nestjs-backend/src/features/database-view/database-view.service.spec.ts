import { describe, expect, it, vi } from 'vitest';
import { DatabaseViewService } from './database-view.service';

describe('DatabaseViewService', () => {
  it('creates materialized views in the data database and stores the view name in metadata', async () => {
    const dataExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined);
    const dataPrisma = {
      $tx: vi.fn(async (fn: (prisma: { $executeRawUnsafe: typeof dataExecuteRawUnsafe }) => void) =>
        fn({ $executeRawUnsafe: dataExecuteRawUnsafe })
      ),
    };
    const metaPrisma = {
      tableMeta: {
        update: vi.fn().mockResolvedValue(undefined),
      },
      $executeRawUnsafe: vi.fn(),
    };
    const dbProvider = {
      createDatabaseView: vi.fn().mockReturnValue(['create materialized view', 'create index']),
      generateDatabaseViewName: vi.fn().mockReturnValue('tblA_view'),
      refreshDatabaseView: vi.fn().mockReturnValue('refresh materialized view'),
    };
    const recordQueryBuilderService = {
      prepareView: vi.fn().mockResolvedValue({ qb: {} }),
    };
    const service = new DatabaseViewService(
      dbProvider as never,
      recordQueryBuilderService as never,
      metaPrisma as never,
      dataPrisma as never,
      {} as never
    );

    await service.createView({ id: 'tblA', dbTableName: 'bseTest.orders' } as never);

    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith('create materialized view');
    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith('create index');
    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith('refresh materialized view');
    expect(metaPrisma.tableMeta.update).toHaveBeenCalledWith({
      where: { id: 'tblA' },
      data: { dbViewName: 'tblA_view' },
    });
    expect(metaPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('drops views from the data database and clears metadata separately', async () => {
    const dataExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined);
    const dataPrisma = {
      $tx: vi.fn(async (fn: (prisma: { $executeRawUnsafe: typeof dataExecuteRawUnsafe }) => void) =>
        fn({ $executeRawUnsafe: dataExecuteRawUnsafe })
      ),
    };
    const metaPrisma = {
      tableMeta: {
        update: vi.fn().mockResolvedValue(undefined),
      },
      $executeRawUnsafe: vi.fn(),
    };
    const dbProvider = {
      dropDatabaseView: vi.fn().mockReturnValue(['drop materialized view', 'drop view']),
    };
    const service = new DatabaseViewService(
      dbProvider as never,
      {} as never,
      metaPrisma as never,
      dataPrisma as never,
      {} as never
    );

    await service.dropView('tblA');

    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith('drop materialized view');
    expect(dataExecuteRawUnsafe).toHaveBeenCalledWith('drop view');
    expect(metaPrisma.tableMeta.update).toHaveBeenCalledWith({
      where: { id: 'tblA' },
      data: { dbViewName: null },
    });
    expect(metaPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
