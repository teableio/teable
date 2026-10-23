/// <reference lib="esnext.promise" />
import { describe, expect, it, vi } from 'vitest';
import { getBaseCached, getSpaceCached, getTableMetaWithBaseCached } from './meta-ancestry-cache';

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

  it('shares an in-flight ancestry read across concurrent guards', async () => {
    const base = { id: 'bse1', spaceId: 'spc1' };
    const { promise: pending, resolve } = Promise.withResolvers<unknown>();
    const reader = {
      tableMeta: { findUnique: vi.fn().mockReturnValue(pending) },
      base: { findUnique: vi.fn() },
      space: { findUnique: vi.fn() },
    };
    const cls = createCls();
    const first = getTableMetaWithBaseCached(cls, reader as never, 'tbl1');
    const second = getTableMetaWithBaseCached(cls, reader as never, 'tbl1');
    const table = { id: 'tbl1', baseId: base.id, base };
    resolve(table);

    expect(await first).toBe(table);
    expect(await second).toBe(table);
    expect(reader.tableMeta.findUnique).toHaveBeenCalledTimes(1);
    expect(await getBaseCached(cls, reader as never, base.id)).toBe(base);
    expect(reader.base.findUnique).not.toHaveBeenCalled();
  });

  it('shares failures with concurrent callers and retries rather than caching rejection', async () => {
    const error = new Error('required base relation is missing');
    const reader = {
      tableMeta: { findUnique: vi.fn().mockRejectedValueOnce(error).mockResolvedValue(null) },
      base: { findUnique: vi.fn() },
      space: { findUnique: vi.fn() },
    };
    const cls = createCls();
    const results = await Promise.allSettled([
      getTableMetaWithBaseCached(cls, reader as never, 'tbl1'),
      getTableMetaWithBaseCached(cls, reader as never, 'tbl1'),
    ]);
    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    expect(await getTableMetaWithBaseCached(cls, reader as never, 'tbl1')).toBeNull();
    expect(reader.tableMeta.findUnique).toHaveBeenCalledTimes(2);
  });

  it('caches missing rows but never shares them between requests', async () => {
    const space = { id: 'spc1', organizationId: null, deletedTime: null };
    const reader = {
      tableMeta: { findUnique: vi.fn() },
      base: { findUnique: vi.fn() },
      space: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(space) },
    };
    const request = createCls();
    expect(await getSpaceCached(request, reader as never, space.id)).toBeNull();
    expect(await getSpaceCached(request, reader as never, space.id)).toBeNull();
    expect(await getSpaceCached(createCls(), reader as never, space.id)).toBe(space);
    expect(reader.space.findUnique).toHaveBeenCalledTimes(2);
  });

  it('preserves deleted rows, nullable columns and Date values for caller filtering', async () => {
    const deletedTime = new Date('2026-01-01T00:00:00.000Z');
    const base = { id: 'bse1', spaceId: 'spc1', deletedTime, icon: null };
    const table = { id: 'tbl1', baseId: base.id, base, deletedTime, description: null };
    const reader = {
      tableMeta: { findUnique: vi.fn().mockResolvedValue(table) },
      base: { findUnique: vi.fn() },
      space: { findUnique: vi.fn() },
    };
    const cls = createCls();
    const cached = await getTableMetaWithBaseCached(cls, reader as never, table.id);
    expect(cached).toBe(table);
    expect(await getBaseCached(cls, reader as never, base.id)).toBe(base);
    expect(cached?.deletedTime).toBe(deletedTime);
    expect(cached?.description).toBeNull();
  });

  it('does not overwrite a pending base read when a table seeds its ancestry', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const base = { id: 'bse1', spaceId: 'spc1' };
    const reader = {
      tableMeta: { findUnique: vi.fn().mockResolvedValue({ id: 'tbl1', base }) },
      base: { findUnique: vi.fn().mockReturnValue(promise) },
      space: { findUnique: vi.fn() },
    };
    const cls = createCls();
    const pendingBase = getBaseCached(cls, reader as never, base.id);
    await getTableMetaWithBaseCached(cls, reader as never, 'tbl1');
    resolve(null);
    expect(await pendingBase).toBeNull();
    expect(await getBaseCached(cls, reader as never, base.id)).toBeNull();
    expect(reader.base.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not seed a base from a missing table', async () => {
    const reader = {
      tableMeta: { findUnique: vi.fn().mockResolvedValue(null) },
      base: { findUnique: vi.fn().mockResolvedValue(null) },
      space: { findUnique: vi.fn() },
    };
    const cls = createCls();
    expect(await getTableMetaWithBaseCached(cls, reader as never, 'tbl1')).toBeNull();
    expect(await getTableMetaWithBaseCached(cls, reader as never, 'tbl1')).toBeNull();
    expect(await getBaseCached(cls, reader as never, 'bse1')).toBeNull();
    expect(reader.tableMeta.findUnique).toHaveBeenCalledTimes(1);
    expect(reader.base.findUnique).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, { isActive: () => false }])(
    'does not cache outside an active request (%s)',
    async (cls) => {
      const reader = {
        tableMeta: { findUnique: vi.fn() },
        base: { findUnique: vi.fn().mockResolvedValue(null) },
        space: { findUnique: vi.fn() },
      };
      await getBaseCached(cls, reader as never, 'bse1');
      await getBaseCached(cls, reader as never, 'bse1');
      expect(reader.base.findUnique).toHaveBeenCalledTimes(2);
    }
  );
});
