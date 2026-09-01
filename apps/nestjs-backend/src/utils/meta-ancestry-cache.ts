import type { Base, Space, TableMeta } from '@teable/db-main-prisma';

export type TableMetaWithBase = TableMeta & { base: Base };

interface IMetaAncestryReader {
  tableMeta: {
    findUnique(args: {
      where: { id: string };
      include: { base: true };
    }): Promise<TableMetaWithBase | null>;
  };
  base: { findUnique(args: { where: { id: string } }): Promise<Base | null> };
  space: { findUnique(args: { where: { id: string } }): Promise<Space | null> };
}

// Structural on purpose: EE and community declare their own IClsStore, and the
// ClsService get/set overloads make the two nominally unassignable across
// packages. Only isActive is checked structurally; get/set are asserted at the
// single access point below.
type MetaAncestryCls = { isActive?: () => boolean } | undefined;

interface IMetaAncestryClsAccess {
  isActive?: () => boolean;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/**
 * Request-scoped dedupe for table → base → space ancestry rows.
 *
 * One request resolves the same ancestry several times across guards
 * (V2FeatureGuard, permission checks, EE authority) — each with its own query
 * and column selection. Cache the FULL rows once per request and let call
 * sites apply their own deletedTime / column filters, so semantics stay
 * per-caller while the meta-db round trips collapse.
 *
 * Rows are cached including soft-deleted ones (`deletedTime` set): callers
 * that exclude deleted resources must check the field themselves.
 */
const getCachedRow = async <T>(
  clsLike: MetaAncestryCls,
  key: string,
  load: () => Promise<T | null>
): Promise<T | null> => {
  const cls = clsLike as IMetaAncestryClsAccess | undefined;
  if (!cls?.isActive?.() || typeof cls.get !== 'function') {
    return load();
  }
  let cache = cls.get('metaAncestryCache') as Map<string, unknown> | undefined;
  if (!cache) {
    cache = new Map<string, unknown>();
    cls.set('metaAncestryCache', cache);
  }
  if (cache.has(key)) {
    return cache.get(key) as T | null;
  }
  const row = await load();
  cache.set(key, row);
  return row;
};

export const getTableMetaWithBaseCached = (
  cls: MetaAncestryCls,
  reader: IMetaAncestryReader,
  tableId: string
): Promise<TableMetaWithBase | null> =>
  getCachedRow(cls, `table:${tableId}`, () =>
    reader.tableMeta.findUnique({ where: { id: tableId }, include: { base: true } })
  );

export const getBaseCached = (
  cls: MetaAncestryCls,
  reader: IMetaAncestryReader,
  baseId: string
): Promise<Base | null> =>
  getCachedRow(cls, `base:${baseId}`, () => reader.base.findUnique({ where: { id: baseId } }));

export const getSpaceCached = (
  cls: MetaAncestryCls,
  reader: IMetaAncestryReader,
  spaceId: string
): Promise<Space | null> =>
  getCachedRow(cls, `space:${spaceId}`, () => reader.space.findUnique({ where: { id: spaceId } }));
