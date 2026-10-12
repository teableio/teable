/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TableOpenApiV2Service } from './table-open-api-v2.service';
import { TableOpenApiService } from './table-open-api.service';

describe('permanent table delete audit', () => {
  const audit = {
    emitAtomic: vi.fn(async () => undefined),
    withOperation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
  };
  const prismaService = {
    tableMeta: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('v1', () => {
    const createService = () => {
      const args: unknown[] = Array.from({ length: 21 }, () => ({}));
      args[0] = prismaService;
      args[18] = audit;
      args[20] = undefined;
      return new (TableOpenApiService as any)(...args) as TableOpenApiService;
    };

    it('writes one table.permanent-delete row per table, inside its own operation', async () => {
      prismaService.tableMeta.findMany.mockResolvedValueOnce([
        { id: 'tbl1', name: 'Orders' },
        { id: 'tbl2', name: 'Customers' },
      ]);
      const service = createService();
      const purge = vi.spyOn(service as any, 'purgeTables').mockResolvedValue(undefined);

      await service.permanentDeleteTables('bse1', ['tbl1', 'tbl2']);

      expect(purge).toHaveBeenCalledWith('bse1', ['tbl1', 'tbl2']);
      expect(audit.withOperation).toHaveBeenCalledWith(
        { rootAction: 'table.permanent-delete', resourceId: 'bse1' },
        expect.any(Function)
      );
      expect(audit.emitAtomic).toHaveBeenCalledTimes(2);
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'table.permanent-delete',
        resourceId: 'tbl1',
        params: { baseId: 'bse1', tableId: 'tbl1', name: 'Orders' },
      });
      // The rows are written after the purge committed.
      expect(purge.mock.invocationCallOrder[0]).toBeLessThan(
        audit.emitAtomic.mock.invocationCallOrder[0]
      );
    });

    it('writes nothing when the purge fails', async () => {
      prismaService.tableMeta.findMany.mockResolvedValueOnce([{ id: 'tbl1', name: 'Orders' }]);
      const service = createService();
      vi.spyOn(service as any, 'purgeTables').mockRejectedValue(new Error('drop failed'));

      await expect(service.permanentDeleteTables('bse1', ['tbl1'])).rejects.toThrow();
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });
  });

  describe('v2', () => {
    const createService = () => {
      const args: unknown[] = Array.from({ length: 11 }, () => ({}));
      args[2] = prismaService;
      args[5] = audit;
      args[9] = undefined;
      return new (TableOpenApiV2Service as any)(...args) as TableOpenApiV2Service;
    };

    it('writes table.permanent-delete after a permanent delete', async () => {
      prismaService.tableMeta.findUnique.mockResolvedValueOnce({ name: 'Orders' });
      const service = createService();
      const execute = vi.spyOn(service as any, 'executeDeleteTable').mockResolvedValue(undefined);

      await service.deleteTable('bse1', 'tbl1', 'permanent');

      expect(execute).toHaveBeenCalledWith('bse1', 'tbl1', 'permanent');
      expect(audit.withOperation).toHaveBeenCalledWith(
        { rootAction: 'table.permanent-delete', resourceId: 'bse1' },
        expect.any(Function)
      );
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'table.permanent-delete',
        resourceId: 'tbl1',
        params: { baseId: 'bse1', tableId: 'tbl1', name: 'Orders' },
      });
    });

    it('leaves a soft delete to its table.delete row', async () => {
      const service = createService();
      vi.spyOn(service as any, 'executeDeleteTable').mockResolvedValue(undefined);

      await service.deleteTable('bse1', 'tbl1');

      expect(audit.withOperation).not.toHaveBeenCalled();
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });
  });
});
