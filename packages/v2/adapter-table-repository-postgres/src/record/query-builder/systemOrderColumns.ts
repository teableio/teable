import { FieldId } from '@teable/v2-core';
import type { OrderByItemBuilder } from 'kysely';

import type { OrderByColumn } from './ITableRecordQueryBuilder';

/**
 * Physical columns that PostgreSQL stores as NOT NULL.
 * Wrapping these in `ORDER BY (col IS NULL)` blocks a btree ordered scan
 * (`__auto_number` in particular) and cannot change result order.
 */
export const isNeverNullSystemOrderColumn = (column: string): boolean =>
  column === '__id' || column === '__auto_number' || column === '__version';

/**
 * V1 Postgres sorts ASC with NULLS FIRST and DESC with NULLS LAST.
 * Native nulls modifiers keep the same order as a leading `(expr IS NULL)`
 * key without doubling the sort list or blocking btree ordered scans.
 */
export const applyV1NullsOrder = (
  direction: 'asc' | 'desc'
): ((builder: OrderByItemBuilder) => OrderByItemBuilder) => {
  return (builder) => {
    const directed = direction === 'asc' ? builder.asc() : builder.desc();
    return direction === 'asc' ? directed.nullsFirst() : directed.nullsLast();
  };
};

export const uniqueOrderByEntries = <T extends { column: OrderByColumn }>(
  entries: ReadonlyArray<T>
): T[] => {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const entry of entries) {
    const key =
      entry.column instanceof FieldId
        ? `field:${entry.column.toString()}`
        : `column:${String(entry.column)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return unique;
};
