import { describe, expect, it, vi } from 'vitest';
import { getBaseCached, getTableMetaWithBaseCached } from './meta-ancestry-cache';

const createCls = () => {
  const store = new Map<string, unknown>();
  return {
    isActive: () => true,
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
};

describe('meta-ancestry-cache', () => {
  it('seeds the base key from a table load so base lookups skip the meta db', async () => {
    const base = { id: 'bse1', spaceId: 'spc1' };
    const reader = {
      tableMeta: { findUnique: vi.fn().mockResolvedValue({ id: 'tbl1', baseId: 'bse1', base }) },
      base: { findUnique: vi.fn() },
      space: { findUnique: vi.fn() },
    };
    const cls = createCls();

    await getTableMetaWithBaseCached(cls, reader as never, 'tbl1');
    const cached = await getBaseCached(cls, reader as never, 'bse1');

    expect(cached).toBe(base);
    expect(reader.base.findUnique).not.toHaveBeenCalled();
  });

  it('keeps a base row loaded first over the copy carried by a later table load', async () => {
    const base = { id: 'bse1', spaceId: 'spc1' };
    const reader = {
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ id: 'tbl1', baseId: 'bse1', base: { ...base } }),
      },
      base: { findUnique: vi.fn().mockResolvedValue(base) },
      space: { findUnique: vi.fn() },
    };
    const cls = createCls();

    await getBaseCached(cls, reader as never, 'bse1');
    await getTableMetaWithBaseCached(cls, reader as never, 'tbl1');

    expect(await getBaseCached(cls, reader as never, 'bse1')).toBe(base);
    expect(reader.base.findUnique).toHaveBeenCalledTimes(1);
  });
});
