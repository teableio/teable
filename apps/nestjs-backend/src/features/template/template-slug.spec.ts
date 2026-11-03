import { describe, expect, it, vi } from 'vitest';
import { ensureTemplateSlug, slugFromName } from './template-slug';

describe('slugFromName', () => {
  it('lowercases, hyphenates and drops punctuation', () => {
    expect(slugFromName('Client CRM with quotes!')).toBe('client-crm-with-quotes');
    expect(slugFromName('  Café & Bakery  ')).toBe('cafe-bakery');
  });

  it('transliterates names in other scripts', () => {
    expect(slugFromName('瑜伽馆管理')).toBe('yu-jia-guan-guan-li');
  });

  it('is empty when nothing is left to name the template by', () => {
    expect(slugFromName('')).toBe('');
    expect(slugFromName(null)).toBe('');
    expect(slugFromName('!!!')).toBe('');
  });

  it('cuts long names at 64 characters without a trailing hyphen', () => {
    const slug = slugFromName(`${'word '.repeat(20)}end`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('ensureTemplateSlug', () => {
  const makePrisma = (taken: string[], { stillEmpty = true, stored = 'client-crm' } = {}) => {
    const updateMany = vi.fn(async () => ({ count: stillEmpty ? 1 : 0 }));
    return {
      updateMany,
      prisma: {
        template: {
          findFirst: vi.fn(async ({ where }: { where: { slug: string } }) =>
            taken.includes(where.slug) ? { id: 'other' } : null
          ),
          findUniqueOrThrow: vi.fn(async () => ({ slug: stored })),
          updateMany,
        },
      } as never,
    };
  };

  it('keeps a slug the template already has', async () => {
    const { prisma, updateMany } = makePrisma([]);
    const row = { id: 'tplA', name: 'Renamed', slug: 'client-crm' };
    expect(await ensureTemplateSlug(prisma, row)).toBe('client-crm');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('names the template after its name, writing only while the slug is still empty', async () => {
    const { prisma, updateMany } = makePrisma([]);
    const row = { id: 'tplA', name: 'Client CRM', slug: null };
    expect(await ensureTemplateSlug(prisma, row)).toBe('client-crm');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'tplA', slug: null },
      data: { slug: 'client-crm' },
    });
  });

  it('takes the next free number when the name is taken', async () => {
    const { prisma } = makePrisma(['client-crm', 'client-crm-2']);
    const row = { id: 'tplA', name: 'Client CRM', slug: null };
    expect(await ensureTemplateSlug(prisma, row)).toBe('client-crm-3');
  });

  it('returns the slug another request wrote first instead of overwriting it', async () => {
    const { prisma } = makePrisma(['client-crm'], { stillEmpty: false, stored: 'client-crm' });
    const row = { id: 'tplA', name: 'Client CRM', slug: null };
    expect(await ensureTemplateSlug(prisma, row)).toBe('client-crm');
  });

  it('moves to the next suffix when another template takes the slug between probe and write', async () => {
    const { prisma, updateMany } = makePrisma([]);
    updateMany.mockRejectedValueOnce({ code: 'P2002' });
    const row = { id: 'tplA', name: 'Client CRM', slug: null };
    expect(await ensureTemplateSlug(prisma, row)).toBe('client-crm-2');
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('falls back to the id when the name gives nothing', async () => {
    const { prisma } = makePrisma([]);
    expect(await ensureTemplateSlug(prisma, { id: 'tplAbC', name: '???', slug: null })).toBe(
      'tplabc'
    );
  });
});
