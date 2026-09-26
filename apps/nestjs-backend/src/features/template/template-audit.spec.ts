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
    base: { update: vi.fn() },
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
      audit as never
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
    kind: null,
    isPublished: false,
    snapshot: JSON.stringify({ baseId: 'bseSnap' }),
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

  it('snapshots inside a template.snapshot.create operation and records the snapshot base', async () => {
    prisma.template.findUniqueOrThrow.mockResolvedValueOnce(original);
    prisma.space.findFirstOrThrow.mockResolvedValueOnce({ id: 'spcTpl' });
    baseDuplicateService.duplicateBase.mockResolvedValueOnce({
      base: { id: 'bseSnap2', spaceId: 'spcTpl', name: 'CRM' },
    });

    await createService().createTemplateSnapshot('tpl1');

    expect(audit.withOperation).toHaveBeenCalledWith(
      { rootAction: 'template.snapshot.create', resourceId: 'tpl1' },
      expect.any(Function)
    );
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'template.snapshot.create',
      resourceId: 'tpl1',
      params: {
        templateId: 'tpl1',
        name: 'CRM',
        baseId: 'bse1',
        snapshotBaseId: 'bseSnap2',
        withRecords: true,
      },
    });
  });
});
