import { describe, expect, it, vi } from 'vitest';
import { TemplateOpenApiService } from './template-open-api.service';

describe('published templates by author', () => {
  it('filters by author in the database before applying the page limit', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `tpl${index}`,
      slug: `template-${index}`,
      createdBy: index === 1000 ? 'usrAuthor' : 'usrOther',
      cover: null,
      snapshot: null,
    }));
    const findMany = vi.fn(async ({ where, skip, take }) =>
      rows
        .filter((row) => !where.createdBy || row.createdBy === where.createdBy)
        .slice(skip, skip + take)
    );
    const prisma = {
      template: { findMany },
      user: {
        findMany: vi.fn(async () => [{ id: 'usrAuthor', name: 'Author', avatar: null }]),
      },
    };
    const service = new TemplateOpenApiService(
      { txClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const templates = await service.getPublishedTemplateList({
      createdBy: 'usrAuthor',
      take: 1000,
    });

    expect(templates.map((template) => template.id)).toEqual(['tpl1000']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdBy: 'usrAuthor', isPublished: true }),
        take: 1000,
      })
    );
  });
});
