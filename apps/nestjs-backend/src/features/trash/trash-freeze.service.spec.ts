import { HttpErrorCode } from '@teable/core';
import { TableTrashType, TrashType } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { TrashService } from './trash.service';

describe('TrashService write freeze', () => {
  const freezeError = new CustomHttpException(
    'Space data database migration is in progress',
    HttpErrorCode.CONFLICT,
    {
      errorCode: 'SPACE_DATA_DB_MIGRATING',
      migrationJobId: 'sdmjxxx',
    }
  );
  const txClient = {
    trash: {
      findUniqueOrThrow: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  const prismaService = {
    $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    txClient: vi.fn(() => txClient),
  };
  const dataDbClientManager = {
    dataPrismaForTable: vi.fn(),
  };
  const spaceService = {
    permanentDeleteSpace: vi.fn(),
  };
  const baseService = {
    permanentDeleteBase: vi.fn(),
  };
  const tableOpenApiService = {
    permanentDeleteTables: vi.fn(),
    restoreTable: vi.fn(),
  };
  const migrationGuard = {
    assertSpaceWritable: vi.fn(),
    assertBaseWritable: vi.fn(),
    assertTableWritable: vi.fn(),
  };

  const service = () =>
    new TrashService(
      { del: vi.fn() } as never,
      prismaService as never,
      { get: vi.fn().mockReturnValue('usrxxx') } as never,
      {} as never,
      { validPermissions: vi.fn() } as never,
      spaceService as never,
      baseService as never,
      tableOpenApiService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataDbClientManager as never,
      {} as never,
      {} as never,
      migrationGuard as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    migrationGuard.assertSpaceWritable.mockRejectedValue(freezeError);
    migrationGuard.assertBaseWritable.mockRejectedValue(freezeError);
    migrationGuard.assertTableWritable.mockRejectedValue(freezeError);
    txClient.trash.findUniqueOrThrow.mockResolvedValue({
      id: 'trhxxx',
      resourceId: 'bsexxx',
      resourceType: TrashType.Base,
      parentId: null,
    });
  });

  it('rejects meta trash restore before restoring or deleting trash metadata', async () => {
    await expect(service().restoreTrash('trhxxx')).rejects.toBe(freezeError);

    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledWith('bsexxx');
    expect(baseService.permanentDeleteBase).not.toHaveBeenCalled();
    expect(tableOpenApiService.restoreTable).not.toHaveBeenCalled();
    expect(txClient.trash.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects data-plane table trash restore before reading target table trash rows', async () => {
    await expect(service().restoreTableResource('optrhxxx', 'tblxxx')).rejects.toBe(freezeError);

    expect(migrationGuard.assertTableWritable).toHaveBeenCalledWith('tblxxx');
    expect(dataDbClientManager.dataPrismaForTable).not.toHaveBeenCalled();
  });

  it('rejects trash reset before resetting table trash rows', async () => {
    await expect(
      service().resetTrashItems({ resourceType: TrashType.Table, resourceId: 'tblxxx' })
    ).rejects.toBe(freezeError);

    expect(migrationGuard.assertTableWritable).toHaveBeenCalledWith('tblxxx');
    expect(dataDbClientManager.dataPrismaForTable).not.toHaveBeenCalled();
  });

  it('rejects permanent delete before deleting base or table resources', async () => {
    await expect(
      service().deleteResource({
        resourceType: TrashType.Table,
        resourceId: 'tblxxx',
        parentId: 'bsexxx',
      })
    ).rejects.toBe(freezeError);
    await expect(
      service().deleteResource({ resourceType: TrashType.Base, resourceId: 'bsexxx' })
    ).rejects.toBe(freezeError);

    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledWith('bsexxx');
    expect(tableOpenApiService.permanentDeleteTables).not.toHaveBeenCalled();
    expect(baseService.permanentDeleteBase).not.toHaveBeenCalled();
  });

  it('rejects restoring table-scoped trash snapshots before field, view, or record writes', async () => {
    const tableTrash = {
      tableId: 'tblxxx',
      resourceType: TableTrashType.Field,
      snapshot: JSON.stringify([{ id: 'fldxxx' }]),
      createdTime: new Date(),
    };
    dataDbClientManager.dataPrismaForTable.mockResolvedValue({
      tableTrash: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(tableTrash),
        delete: vi.fn(),
      },
      recordTrash: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    });

    await expect(service().restoreTableResource('optrhxxx', 'tblxxx')).rejects.toBe(freezeError);

    expect(migrationGuard.assertTableWritable).toHaveBeenCalledWith('tblxxx');
    expect(dataDbClientManager.dataPrismaForTable).not.toHaveBeenCalled();
  });
});
