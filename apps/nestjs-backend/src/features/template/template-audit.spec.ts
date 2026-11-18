/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateOpenApiService } from './template-open-api.service';

describe('TemplateOpenApiService audit rows', () => {
  const audit = {
    emitAtomic: vi.fn(async () => undefined),
    withOperation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
  };
  const prisma = {
    template: {
      aggregate: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    space: { findFirstOrThrow: vi.fn() },
    base: {
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ spaceId: 'spcTemplates' })),
    },
    trash: { upsert: vi.fn() },
  };
  const prismaService = {
    txClient: vi.fn(() => prisma),
    $tx: vi.fn(async (fn: (client: typeof prisma) => Promise<unknown>) => fn(prisma)),
  };
  const baseDuplicateService = { duplicateBase: vi.fn() };
  const performanceCacheService = { del: vi.fn() };
  const shortLinkService = { markDeletedByResource: vi.fn() };

  const createService = () =>
    new TemplateOpenApiService(
      prismaService as never,
      baseDuplicateService as never,
      { get: vi.fn(() => 'usr1') } as never,
      {} as never,
      { bigTransactionTimeout: 1000 } as never,
      performanceCacheService as never,
      shortLinkService as never,
      audit as never,
      {} as never
    );

  const original = {
    id: 'tpl1',
    name: 'CRM',
    description: 'old',
    markdownDescription: null,
    categoryId: ['cat1'],
    cover: null,
    featured: false,
    isSystem: false,
    baseId: 'bse1',
    isPublished: false,
    snapshot: JSON.stringify({ baseId: 'bseSnap' }),
    slug: 'crm',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.template.update.mockImplementation(async ({ data }) => ({ ...original, ...data }));
  });

  it('writes template.create for a new template', async () => {
    prisma.template.aggregate.mockResolvedValueOnce({ _max: { order: 3 } });
    prisma.template.create.mockImplementationOnce(async ({ data }) => data);

    const template = await createService().createTemplate({ name: 'CRM' });

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'template.create',
      resourceId: template.id,
      params: { templateId: template.id, name: 'CRM' },
    });
  });

  it('writes template.publish when a template goes public, and template.update for the other changed fields', async () => {
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce(original);

    await createService().updateTemplate('tpl1', {
      isPublished: true,
      name: 'CRM',
      description: 'new',
      categoryId: ['cat1'],
    });

    expect(audit.emitAtomic).toHaveBeenCalledTimes(2);
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'template.update',
      resourceId: 'tpl1',
      params: { templateId: 'tpl1', name: 'CRM', baseId: 'bse1', changedKeys: ['description'] },
    });
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'template.publish',
      resourceId: 'tpl1',
      params: { templateId: 'tpl1', name: 'CRM', baseId: 'bse1' },
    });
  });

  it('writes template.unpublish when a public template is withdrawn, and nothing for an unchanged save', async () => {
    const service = createService();
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce({ ...original, isPublished: true });
    await service.updateTemplate('tpl1', { isPublished: false });
    expect(audit.emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.unpublish', resourceId: 'tpl1' })
    );

    audit.emitAtomic.mockClear();
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce(original);
    await service.updateTemplate('tpl1', { name: 'CRM', isPublished: false, featured: false });
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('keeps the links of a template published before histories when it is taken off the catalogue', async () => {
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce({
      ...original,
      isPublished: true,
      featured: true,
      history: null,
      version: 2,
    });

    await createService().updateTemplate('tpl1', { featured: false, isPublished: false });

    // the history is what keeps a template's links opening once it is not listed
    expect(prisma.template.update.mock.calls[0][0].data.history).toEqual([
      expect.objectContaining({ version: 2 }),
    ]);
  });

  it('writes no history for a template that never went out, or already has one', async () => {
    const service = createService();
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce({ ...original, history: null });
    await service.updateTemplate('tpl1', { isPublished: false });
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce({
      ...original,
      isPublished: true,
      history: [{ version: 1, publishedTime: '2026-11-01T00:00:00.000Z' }],
    });
    await service.updateTemplate('tpl1', { isPublished: false });

    for (const [args] of prisma.template.update.mock.calls) {
      expect(args.data).not.toHaveProperty('history');
    }
  });

  it('records the previous source base when the template is pointed at another base', async () => {
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce(original);

    await createService().updateTemplate('tpl1', { baseId: 'bse2' });

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'template.update',
      resourceId: 'tpl1',
      params: {
        templateId: 'tpl1',
        name: 'CRM',
        baseId: 'bse2',
        changedKeys: ['baseId'],
        previousBaseId: 'bse1',
      },
    });
  });

  it('writes template.delete, also for the owner unpublish route', async () => {
    prisma.template.delete.mockResolvedValueOnce({ ...original, isPublished: true });

    await createService().deleteTemplate('tpl1');

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'template.delete',
      resourceId: 'tpl1',
      params: { templateId: 'tpl1', name: 'CRM', baseId: 'bse1', wasPublished: true },
    });
  });

  it('sends the snapshot of a deleted template to the trash, so the cleanup purges it', async () => {
    prisma.template.delete.mockResolvedValueOnce({ ...original });

    await createService().deleteTemplate('tpl1');

    expect(prisma.base.updateMany).toHaveBeenCalledWith({
      where: { id: 'bseSnap', deletedTime: null },
      data: { deletedTime: expect.any(Date) },
    });
    expect(prisma.trash.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          resourceType: 'base',
          resourceId: 'bseSnap',
          parentId: 'spcTemplates',
          deletedTime: expect.any(Date),
          deletedBy: 'usr1',
        },
      })
    );
  });

  it('leaves a snapshot that is retired already as it is', async () => {
    prisma.template.delete.mockResolvedValueOnce({ ...original });
    prisma.base.updateMany.mockResolvedValueOnce({ count: 0 });

    await createService().deleteTemplate('tpl1');

    expect(prisma.trash.upsert).not.toHaveBeenCalled();
  });
});
