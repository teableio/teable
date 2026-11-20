/* eslint-disable @typescript-eslint/no-explicit-any */
import { SettingKey, TableTrashType, TrashType } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseTrashHandler } from '../base/base.trash-handler';
import { FolderTrashHandler } from '../base-node/folder/folder.trash-handler';
import { DashboardTrashHandler } from '../dashboard/dashboard.trash-handler';
import { SpaceTrashHandler } from '../space/space.trash-handler';
import { TableTrashHandler } from '../table/table.trash-handler';
import { TrustedRetentionContextService } from '../table-lifecycle/trusted-retention-context.service';
import { TrashResourceHandlerRegistry } from './resource/trash-resource-handler.registry';
import { TrashService } from './trash.service';

describe('TrashService audit rows', () => {
  const audit = {
    emitAtomic: vi.fn(async () => undefined),
    withOperation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
  };
  const txClient = {
    trash: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    space: { update: vi.fn() },
    base: { findUnique: vi.fn(async () => ({ spaceId: 'spc1', v2Enabled: true })) },
    // What a trash row names is deleted here: no resource is found in use.
    tableMeta: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    dashboard: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    baseNodeFolder: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    baseNode: { findMany: vi.fn(async () => []) },
  };
  const prismaService = {
    $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    txClient: vi.fn(() => txClient),
    trash: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    space: { findUnique: vi.fn() },
    base: { findUnique: vi.fn() },
    baseNodeFolder: { findMany: vi.fn(async () => []) },
  };
  const spaceService = { permanentDeleteSpace: vi.fn() };
  const baseService = { permanentDeleteBase: vi.fn() };
  const tableOpenApiService = { permanentDeleteTables: vi.fn() };
  const tableOpenApiV2Service = { permanentDeleteTables: vi.fn() };
  const permissionService = { validPermissions: vi.fn() };

  const createService = () => {
    const service = new TrashService(
      { del: vi.fn() } as never,
      prismaService as never,
      { get: vi.fn().mockReturnValue(undefined) } as never,
      {} as never,
      permissionService as never,
      spaceService as never,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    (service as any).audit = audit;
    const cls = { get: vi.fn().mockReturnValue(undefined) };
    (service as any).resourceHandlers = new TrashResourceHandlerRegistry([
      new TableTrashHandler(
        prismaService as never,
        cls as never,
        tableOpenApiService as never,
        tableOpenApiV2Service as never,
        { shouldUseV2ForBaseWithReason: vi.fn(async () => ({ useV2: true })) } as never
      ),
      new DashboardTrashHandler(prismaService as never),
      new FolderTrashHandler(prismaService as never, cls as never, permissionService as never),
      new SpaceTrashHandler(prismaService as never, spaceService as never),
      new BaseTrashHandler(prismaService as never, baseService as never),
    ]);
    return service;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('restore', () => {
    it('writes space.restore once the restore committed', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'spc1',
        resourceType: TrashType.Space,
        parentId: null,
      });
      prismaService.space.findUnique.mockResolvedValue({ name: 'Sales' });

      await createService().restoreTrash('trh1');

      expect(txClient.space.update).toHaveBeenCalledWith({
        where: { id: 'spc1' },
        data: { deletedTime: null },
      });
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'space.restore',
        resourceId: 'spc1',
        params: { spaceId: 'spc1', name: 'Sales', trashId: 'trh1' },
      });
    });

    it('writes base.restore scoped to its space', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh2',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
      });
      const service = createService();
      vi.spyOn(service as any, 'assertParentNotTrashed').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'restoreResource').mockResolvedValue([]);
      prismaService.base.findUnique.mockResolvedValue({ name: 'CRM', spaceId: 'spc1' });

      await service.restoreTrash('trh2');

      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.restore',
        resourceId: 'bse1',
        params: { baseId: 'bse1', spaceId: 'spc1', name: 'CRM', trashId: 'trh2' },
      });
    });

    it('leaves a table restore to its own table.restore row', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh3',
        resourceId: 'tbl1',
        resourceType: TrashType.Table,
        parentId: 'bse1',
      });
      const service = createService();
      vi.spyOn(service as any, 'assertParentNotTrashed').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'restoreResource').mockResolvedValue([]);

      await service.restoreTrash('trh3');

      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('writes nothing when the restore fails', async () => {
      txClient.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'spc1',
        resourceType: TrashType.Space,
        parentId: null,
      });
      const service = createService();
      vi.spyOn(service as any, 'restoreResource').mockRejectedValue(new Error('boom'));

      await expect(service.restoreTrash('trh1')).rejects.toThrow('boom');
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });
  });

  describe('permanent delete', () => {
    // The purge reads its row again under the project's lock.
    beforeEach(() => {
      prismaService.trash.findUnique.mockImplementation(() =>
        prismaService.trash.findUniqueOrThrow()
      );
      txClient.trash.findUnique.mockImplementation(() => prismaService.trash.findUniqueOrThrow());
    });

    it('writes base.permanent-delete with the name read before the purge', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
      });
      prismaService.base.findUnique.mockResolvedValue({ name: 'CRM', spaceId: 'spc1' });

      await createService().delete('trh1');

      expect(baseService.permanentDeleteBase).toHaveBeenCalledWith('bse1', false);
      expect(prismaService.base.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
        baseService.permanentDeleteBase.mock.invocationCallOrder[0]
      );
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.permanent-delete',
        resourceId: 'bse1',
        params: { baseId: 'bse1', spaceId: 'spc1', name: 'CRM', trashId: 'trh1' },
      });
    });

    it('writes space.permanent-delete, flagged when a BYODB space is force removed', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'spc1',
        resourceType: TrashType.Space,
        parentId: null,
      });
      prismaService.space.findUnique.mockResolvedValue({ name: 'Sales' });

      await createService().delete('trh1', false, { force: true });

      expect(spaceService.permanentDeleteSpace).toHaveBeenCalledWith('spc1', false, {
        force: true,
      });
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'space.permanent-delete',
        resourceId: 'spc1',
        params: { spaceId: 'spc1', name: 'Sales', trashId: 'trh1', force: true },
      });
    });

    it('leaves a table purge to the table service row', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'tbl1',
        resourceType: TrashType.Table,
        parentId: 'bse1',
      });

      await createService().delete('trh1');

      expect(tableOpenApiV2Service.permanentDeleteTables).toHaveBeenCalledWith('bse1', ['tbl1']);
      expect(tableOpenApiService.permanentDeleteTables).not.toHaveBeenCalled();
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('writes nothing for the retention sweep, which has no user', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
        deletedTime: new Date(0),
      });

      const retention = new TrustedRetentionContextService(
        prismaService as never,
        {
          getSetting: vi.fn(async () => ({
            [SettingKey.TRASH_CLEANUP_ENABLED_AT]: new Date(0).toISOString(),
          })),
        } as never,
        { retention: 1000 } as never
      );
      const service = createService();
      Object.assign(service, { trustedRetentionContextService: retention });
      const capability = await retention.issueForExpiredTrash('trh1');

      await service.delete('trh1', true, undefined, capability);

      expect(baseService.permanentDeleteBase).toHaveBeenCalledWith('bse1', true);
      expect(prismaService.base.findUnique).not.toHaveBeenCalled();
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('still purges when the name lookup fails', async () => {
      prismaService.trash.findUniqueOrThrow.mockResolvedValue({
        id: 'trh1',
        resourceId: 'bse1',
        resourceType: TrashType.Base,
        parentId: 'spc1',
      });
      prismaService.base.findUnique.mockRejectedValueOnce(new Error('db down'));

      await createService().delete('trh1');

      expect(baseService.permanentDeleteBase).toHaveBeenCalled();
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.permanent-delete',
        resourceId: 'bse1',
        params: { trashId: 'trh1' },
      });
    });
  });

  describe('reset', () => {
    it('writes one trash.reset row per base with what the trash held, in its own operation', async () => {
      prismaService.trash.findMany.mockResolvedValue([
        { resourceType: TrashType.Table },
        { resourceType: TrashType.Table },
        { resourceType: TrashType.App },
      ]);
      const service = createService();
      const resetBase = vi
        .spyOn(service as any, 'resetBaseTrashResource')
        .mockResolvedValue(undefined);

      await service.resetTrashItems({ resourceType: TrashType.Base, resourceId: 'bse1' });

      expect(audit.withOperation).toHaveBeenCalledWith(
        { rootAction: 'trash.reset', resourceId: 'bse1' },
        expect.any(Function)
      );
      expect(resetBase).toHaveBeenCalled();
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'trash.reset',
        resourceId: 'bse1',
        params: {
          resourceType: TrashType.Base,
          baseId: 'bse1',
          counts: { table: 2, app: 1 },
        },
      });
    });

    it('counts what the trashed folders hold, as the reset purges it too', async () => {
      prismaService.baseNodeFolder.findMany.mockResolvedValue([{ id: 'bnf1' }] as never);
      prismaService.trash.findMany.mockResolvedValue([
        { resourceType: TrashType.Folder },
        { resourceType: TrashType.Dashboard },
        { resourceType: TrashType.Table },
      ]);
      const service = createService();
      vi.spyOn(service as any, 'resetBaseTrashResource').mockResolvedValue(undefined);

      await service.resetTrashItems({ resourceType: TrashType.Base, resourceId: 'bse1' });

      expect(prismaService.trash.findMany).toHaveBeenCalledWith({
        where: { parentId: { in: ['bse1', 'bnf1'] } },
        select: { resourceType: true },
      });
      expect(audit.emitAtomic).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'trash.reset',
          params: expect.objectContaining({ counts: { folder: 1, dashboard: 1, table: 1 } }),
        })
      );
    });

    it('writes nothing when the base trash was already empty', async () => {
      prismaService.trash.findMany.mockResolvedValue([]);
      const service = createService();
      vi.spyOn(service as any, 'resetBaseTrashResource').mockResolvedValue(undefined);

      await service.resetTrashItems({ resourceType: TrashType.Base, resourceId: 'bse1' });

      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });

    it('counts the views, fields and records purged from a table trash', async () => {
      const service = createService();
      vi.spyOn(service as any, 'resetTableTrashItems').mockResolvedValue({
        view: 1,
        field: 2,
        record: 30,
      });

      await service.resetTrashItems({ resourceType: TrashType.Table, resourceId: 'tbl1' });

      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'trash.reset',
        resourceId: 'tbl1',
        params: {
          resourceType: TrashType.Table,
          tableId: 'tbl1',
          counts: { view: 1, field: 2, record: 30 },
        },
      });
    });

    it('returns the purged counts from the table trash reset', async () => {
      const service = createService();
      const tableTrash = {
        findMany: vi.fn().mockResolvedValue([
          { resourceType: TableTrashType.View, snapshot: JSON.stringify(['viw1']) },
          {
            resourceType: TableTrashType.Field,
            snapshot: JSON.stringify({ fields: [{ id: 'fld1' }, { id: 'fld2' }] }),
          },
          { resourceType: TableTrashType.Record, snapshot: JSON.stringify(['rec1', 'rec1']) },
        ]),
        deleteMany: vi.fn(),
      };
      vi.spyOn(service as any, 'trashDataPrismaForTable').mockResolvedValue({ tableTrash });
      vi.spyOn(service as any, 'trashDataPrismaTransactionForTable').mockResolvedValue(undefined);
      (service as any).recordRemovalColdStorageService = { deleteReasonPrefix: vi.fn() };
      const commentCleanup = { purgeRecordComments: vi.fn() };
      const attachmentDb = {
        deleteFrom: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(undefined),
      };
      (service as any).v2ContainerService = {
        getContainerForTable: vi.fn().mockResolvedValue({
          resolve: vi.fn().mockReturnValue(attachmentDb),
        }),
      };
      (service as any).recordCommentCleanupService = commentCleanup;
      prismaService.$tx.mockResolvedValueOnce(undefined);

      await expect((service as any).resetTableTrashItems('tbl1')).resolves.toEqual({
        view: 1,
        field: 2,
        record: 1,
      });
      expect((service as any).v2ContainerService.getContainerForTable).toHaveBeenCalledWith('tbl1');
    });

    it('purges ops for a trash larger than the postgres bind parameter limit', async () => {
      const service = createService();
      const recordIds = Array.from({ length: 70_000 }, (_, i) => `rec${i}`);
      const tableTrash = {
        findMany: vi.fn().mockResolvedValue([
          { resourceType: TableTrashType.View, snapshot: JSON.stringify(['viw1']) },
          { resourceType: TableTrashType.Record, snapshot: JSON.stringify(recordIds) },
        ]),
      };
      vi.spyOn(service as any, 'trashDataPrismaForTable').mockResolvedValue({ tableTrash });
      vi.spyOn(service as any, 'trashDataPrismaTransactionForTable').mockResolvedValue(undefined);
      (service as any).recordRemovalColdStorageService = { deleteReasonPrefix: vi.fn() };
      (service as any).recordCommentCleanupService = { purgeRecordComments: vi.fn() };
      const tx = {
        view: { deleteMany: vi.fn() },
        field: { deleteMany: vi.fn() },
        taskReference: { deleteMany: vi.fn() },
        ops: { deleteMany: vi.fn() },
      };
      prismaService.$tx.mockImplementationOnce(async (fn: (client: any) => Promise<unknown>) =>
        fn(tx)
      );

      await (service as any).resetTableTrashItems('tbl1');

      const batches: string[][] = tx.ops.deleteMany.mock.calls.map(
        ([args]: any[]) => args.where.docId.in
      );
      expect(batches.every((ids) => ids.length <= 32767)).toBe(true);
      expect(new Set(batches.flat())).toEqual(new Set(['viw1', ...recordIds]));
      expect(
        tx.ops.deleteMany.mock.calls.every(([args]: any[]) => args.where.collection === 'tbl1')
      ).toBe(true);
    });
  });
});
