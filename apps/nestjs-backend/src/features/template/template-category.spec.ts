/* eslint-disable @typescript-eslint/no-explicit-any */
import { TemplateCategoryKind } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateOpenApiService } from './template-open-api.service';

describe('TemplateOpenApiService categories: kind and key', () => {
  const prisma = {
    templateCategory: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(),
      findFirst: vi.fn(async (_args: unknown): Promise<{ id: string } | null> => null),
      aggregate: vi.fn(async () => ({ _max: { order: 2 } })),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
      update: vi.fn(async ({ data }: { data: unknown }) => data),
    },
  };
  const prismaService = { txClient: vi.fn(() => prisma) };

  const createService = () =>
    new TemplateOpenApiService(
      prismaService as never,
      {} as never,
      { get: vi.fn(() => 'usr1') } as never,
      {} as never,
      { bigTransactionTimeout: 1000 } as never,
      { del: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.templateCategory.findFirst.mockResolvedValue(null);
  });

  it('files a new category as an industry with a key made from its name', async () => {
    const created: any = await createService().createTemplateCategory({ name: 'Yoga studios' });
    expect(created).toMatchObject({
      name: 'Yoga studios',
      kind: TemplateCategoryKind.Industry,
      key: 'yoga-studios',
      parentId: undefined,
    });
  });

  it('leaves the key empty when the one made from the name is taken', async () => {
    prisma.templateCategory.findFirst.mockResolvedValueOnce({ id: 'tpcOther' });
    const created: any = await createService().createTemplateCategory({ name: 'Yoga studios' });
    expect(created.key).toBeNull();
  });

  it('refuses a key an admin typed that another category already has', async () => {
    prisma.templateCategory.findFirst.mockResolvedValueOnce({ id: 'tpcOther' });
    await expect(
      createService().createTemplateCategory({ name: 'Yoga', key: 'yoga' })
    ).rejects.toMatchObject({ message: 'Key already in use' });
  });

  it('keeps teams flat: no parent on a team, no sub-category under a team', async () => {
    await expect(
      createService().createTemplateCategory({
        name: 'Sales',
        kind: TemplateCategoryKind.Team,
        parentId: 'tpcParent',
      })
    ).rejects.toMatchObject({ message: 'A team has neither a parent nor sub-categories' });

    prisma.templateCategory.findUnique.mockResolvedValueOnce({
      parentId: null,
      kind: TemplateCategoryKind.Team,
    } as never);
    await expect(
      createService().createTemplateCategory({ name: 'Inside sales', parentId: 'tpcSales' })
    ).rejects.toMatchObject({ message: 'A team has neither a parent nor sub-categories' });
  });

  it('still allows one level of sub-industries', async () => {
    prisma.templateCategory.findUnique.mockResolvedValueOnce({
      parentId: null,
      kind: TemplateCategoryKind.Industry,
    } as never);
    const created: any = await createService().createTemplateCategory({
      name: 'Pilates',
      parentId: 'tpcWellness',
    });
    expect(created).toMatchObject({ parentId: 'tpcWellness', kind: TemplateCategoryKind.Industry });
  });

  it('updates the key alone, and null clears it', async () => {
    const service = createService();
    await service.updateTemplateCategory('tpcA', { key: 'yoga' });
    expect(prisma.templateCategory.update).toHaveBeenLastCalledWith({
      where: { id: 'tpcA' },
      data: { name: undefined, key: 'yoga' },
    });
    await service.updateTemplateCategory('tpcA', { key: null });
    expect(prisma.templateCategory.update).toHaveBeenLastCalledWith({
      where: { id: 'tpcA' },
      data: { name: undefined, key: null },
    });
  });

  it('refuses a key update that collides with another category but not with itself', async () => {
    prisma.templateCategory.findFirst.mockImplementationOnce(async (args: any) =>
      args.where.key === 'yoga' && args.where.NOT?.id === 'tpcA' ? { id: 'tpcOther' } : null
    );
    await expect(
      createService().updateTemplateCategory('tpcA', { key: 'yoga' })
    ).rejects.toMatchObject({ message: 'Key already in use' });
  });
});
