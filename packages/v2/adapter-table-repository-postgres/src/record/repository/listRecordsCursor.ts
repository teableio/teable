import {
  FieldType,
  isSystemColumnOrderBy,
  type Field,
  type ITableRecordQueryStreamOptions,
  type TableRecordOrderBy,
  type TableRecordReadModel,
} from '@teable/v2-core';
import { sql, type Expression, type RawBuilder, type SqlBool } from 'kysely';

export const CURSOR_ORDER_BY_ERROR =
  'Cursor pagination supports stored scalar order keys plus __auto_number asc';

export type CursorSeekKey = {
  readonly left: RawBuilder<unknown>;
  readonly right: RawBuilder<unknown>;
  readonly direction: 'asc' | 'desc';
  readonly matchV1Nulls: boolean;
};

export const parseCursorToken = (cursor: string | undefined): number | undefined => {
  if (!cursor) {
    return undefined;
  }
  const parsed = Number(cursor);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
};

export const getLastAutoNumberCursor = (
  records: ReadonlyArray<TableRecordReadModel>
): string | undefined => {
  const lastRecord = records[records.length - 1];
  if (
    !lastRecord ||
    typeof lastRecord.autoNumber !== 'number' ||
    !Number.isFinite(lastRecord.autoNumber)
  ) {
    return undefined;
  }
  return String(Math.floor(lastRecord.autoNumber));
};

export const isAutoNumberOnlyCursorOrderBy = (
  orderBy: ITableRecordQueryStreamOptions['orderBy']
): boolean => {
  if (!orderBy?.length) {
    return true;
  }

  return orderBy.every(
    (sort) =>
      isSystemColumnOrderBy(sort) && sort.column === '__auto_number' && sort.direction === 'asc'
  );
};

export const isRawColumnCursorField = (field: Field): boolean => {
  const type = field.type();
  return (
    type.equals(FieldType.singleLineText()) ||
    type.equals(FieldType.longText()) ||
    type.equals(FieldType.number()) ||
    type.equals(FieldType.rating()) ||
    type.equals(FieldType.checkbox()) ||
    type.equals(FieldType.autoNumber())
  );
};

const afterExpr = (key: CursorSeekKey): RawBuilder<SqlBool> => {
  if (!key.matchV1Nulls) {
    if (key.direction === 'asc') {
      return sql`${key.left} > ${key.right}`;
    }
    return sql`${key.left} < ${key.right}`;
  }
  if (key.direction === 'asc') {
    return sql`((${key.right} is null and ${key.left} is not null) or (${key.left} > ${key.right}))`;
  }
  return sql`((${key.right} is not null and ${key.left} is null) or (${key.left} < ${key.right}))`;
};

export const buildKeysetSeekPredicate = (
  keys: ReadonlyArray<CursorSeekKey>
): RawBuilder<SqlBool> => {
  const parts = keys.map((key, index) => {
    const equalsPrefix = keys
      .slice(0, index)
      .map((prefix) => sql`${prefix.left} is not distinct from ${prefix.right}`);
    return sql`(${sql.join([...equalsPrefix, afterExpr(key)], sql` and `)})`;
  });
  return sql`(${sql.join(parts, sql` or `)})`;
};

export const buildBookmarkSeekExists = (
  tableRef: RawBuilder<unknown>,
  autoNumber: number,
  keys: ReadonlyArray<CursorSeekKey>
): Expression<SqlBool> => {
  return sql`exists (
    select 1
    from ${tableRef} as __seek
    where __seek.__auto_number = ${autoNumber}
      and ${buildKeysetSeekPredicate(keys)}
  )` as Expression<SqlBool>;
};

export const orderByHasAutoNumberAsc = (
  orderBy: ReadonlyArray<TableRecordOrderBy> | undefined
): boolean => {
  if (!orderBy?.length) {
    return true;
  }
  return orderBy.some(
    (sort) =>
      isSystemColumnOrderBy(sort) && sort.column === '__auto_number' && sort.direction === 'asc'
  );
};
