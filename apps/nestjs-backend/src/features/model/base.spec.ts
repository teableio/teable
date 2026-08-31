import type { PrismaService } from '@teable/db-main-prisma';
import { BaseModel } from './base';

describe('BaseModel', () => {
  const buildModel = (rows: Array<{ id?: string; spaceId: string }>) => {
    const findUnique = vi.fn().mockResolvedValue(rows[0] ?? null);
    const findMany = vi.fn().mockResolvedValue(rows);
    const prismaService = { base: { findUnique, findMany } } as unknown as PrismaService;
    return { model: new BaseModel(prismaService), findUnique, findMany };
  };

  describe('getSpaceIdByBaseId', () => {
    it('excludes trashed bases by default', async () => {
      const { model, findUnique } = buildModel([{ spaceId: 'spc1' }]);

      expect(await model.getSpaceIdByBaseId('bse1')).toBe('spc1');
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'bse1', deletedTime: null } })
      );
    });

    it('resolves a trashed base when asked to', async () => {
      const { model, findUnique } = buildModel([{ spaceId: 'spc1' }]);

      await model.getSpaceIdByBaseId('bse1', { includeDeleted: true });

      expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bse1' } }));
    });

    it('raises a 404 when the base is gone', async () => {
      const { model } = buildModel([]);

      await expect(model.getSpaceIdByBaseId('bse1')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getSpaceIdByBaseId with shouldThrow off', () => {
    it('resolves undefined instead of raising when the base is gone', async () => {
      const { model } = buildModel([]);

      expect(await model.getSpaceIdByBaseId('bse1', { shouldThrow: false })).toBeUndefined();
    });
  });

  describe('getSpaceIdsByBaseIds', () => {
    it('omits bases that did not resolve', async () => {
      const { model } = buildModel([{ id: 'bse1', spaceId: 'spc1' }]);

      const resolved = await model.getSpaceIdsByBaseIds(['bse1', 'bse2']);

      expect(resolved).toEqual(new Map([['bse1', 'spc1']]));
    });

    it('short-circuits an empty batch', async () => {
      const { model, findMany } = buildModel([]);

      expect(await model.getSpaceIdsByBaseIds([])).toEqual(new Map());
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
