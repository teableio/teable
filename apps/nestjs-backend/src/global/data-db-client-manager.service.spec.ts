import { describe, expect, it, vi } from 'vitest';
import { encryptDataDbUrl } from '../features/space/data-db-url-secret';
import { DataDbClientManager } from './data-db-client-manager.service';

describe('DataDbClientManager', () => {
  it('uses the default data DB clients when a space has no BYODB binding', async () => {
    const prismaService = {
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const defaultDataPrisma = {};
    const defaultDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      defaultDataPrisma as never,
      defaultDataKnex as never
    );

    await expect(manager.dataPrismaForSpace('spcxxx')).resolves.toBe(defaultDataPrisma);
    await expect(manager.dataKnexForSpace('spcxxx')).resolves.toBe(defaultDataKnex);
  });

  it('resolves base scoped clients through the base space', async () => {
    const prismaService = {
      base: {
        findUnique: vi.fn().mockResolvedValue({ spaceId: 'spcxxx' }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const defaultDataPrisma = {};
    const defaultDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      defaultDataPrisma as never,
      defaultDataKnex as never
    );

    await expect(manager.dataPrismaForBase('bsexxx')).resolves.toBe(defaultDataPrisma);
    await expect(manager.dataKnexForBase('bsexxx')).resolves.toBe(defaultDataKnex);
    expect(prismaService.base.findUnique).toHaveBeenCalledWith({
      where: { id: 'bsexxx' },
      select: { spaceId: true },
    });
  });

  it('resolves BYODB connection details from a ready space binding', async () => {
    const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
    const prismaService = {
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: 'dcnxxx',
            status: 'ready',
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    };
    const defaultDataPrisma = {};
    const defaultDataKnex = {};
    const manager = new DataDbClientManager(
      prismaService as never,
      defaultDataPrisma as never,
      defaultDataKnex as never
    );

    await expect(manager.getDataDatabaseUrlForSpace('spcxxx')).resolves.toBe(dataUrl);
    await expect(manager.dataKnexForSpace('spcxxx')).resolves.not.toBe(defaultDataKnex);
    await manager.onModuleDestroy();
  });
});
