import {
  FieldType,
  isSystemColumnOrderBy,
  type Field,
  type ITableRecordQueryStreamOptions,
  type TableRecordOrderBy,
  type TableRecordReadModel,
} from '@teable/v2-core';
import { sql, type RawBuilder, type SqlBool } from 'kysely';

export const CURSOR_ORDER_BY_ERROR =
  'Cursor pagination supports stored scalar order keys plus __auto_number asc';

/** A cursor issued for one order shape cannot be resumed under another one. */
export const CURSOR_STALE_ERROR =
  'Cursor was issued for a different order shape; restart pagination from the first page';

const CURSOR_TOKEN_PREFIX = 'v1:';
const CURSOR_VALUE_ALIAS_PREFIX = '__cursor_';
const AUTO_NUMBER_COLUMN = '__auto_number';
const ROW_ORDER_COLUMN_PREFIX = '__row_';
/** A token carries one triple per order key; anything longer is not ours. */
const MAX_CURSOR_TOKEN_LENGTH = 4096;

export type CursorSeekKey = {
  /** Physical column: the SQL operand, and the identity the token carries. */
  readonly column: string;
  readonly direction: 'asc' | 'desc';
  readonly matchV1Nulls: boolean;
};

/** A single order-key value, restricted to what PostgreSQL can bind as a parameter. */
export type CursorValue = string | number | boolean | null;

type CursorTokenEntry = {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
  readonly value: CursorValue;
};

export type ParsedCursor =
  | { readonly kind: 'auto-number'; readonly autoNumber: number }
  | { readonly kind: 'values'; readonly entries: ReadonlyArray<CursorTokenEntry> };

/** Output alias the page query uses to carry one order key's value back. */
export const cursorValueAlias = (index: number): string => `${CURSOR_VALUE_ALIAS_PREFIX}${index}`;

const isCursorValue = (value: unknown): value is Exclude<CursorValue, null> =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  // NaN and the infinities have no JSON representation, so they would come back as null
  // and seek from the wrong position.
  (typeof value === 'number' && Number.isFinite(value));

/**
 * Cursors are opaque to clients. The legacy shape is the bare `__auto_number` of the
 * last row (still issued, and still cheapest, when the order is `__auto_number` asc);
 * every other order gets a value token carrying one entry per order key.
 */
export const parseCursorToken = (cursor: string | undefined): ParsedCursor | undefined => {
  if (!cursor) {
    return undefined;
  }
  if (cursor.length > MAX_CURSOR_TOKEN_LENGTH) {
    return undefined;
  }
  if (!cursor.startsWith(CURSOR_TOKEN_PREFIX)) {
    const parsed = Number(cursor);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }
    return { kind: 'auto-number', autoNumber: Math.floor(parsed) };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_TOKEN_PREFIX.length), 'base64url').toString('utf8')
    );
  } catch {
    return undefined;
  }
  if (!Array.isArray(decoded)) {
    return undefined;
  }

  const entries: CursorTokenEntry[] = [];
  for (const item of decoded) {
    if (!Array.isArray(item) || item.length !== 3) {
      return undefined;
    }
    const [column, direction, value] = item as [unknown, unknown, unknown];
    if (typeof column !== 'string' || (direction !== 'asc' && direction !== 'desc')) {
      return undefined;
    }
    if (value !== null && !isCursorValue(value)) {
      return undefined;
    }
    entries.push({ column, direction, value });
  }
  return { kind: 'values', entries };
};

export const encodeCursorToken = (entries: ReadonlyArray<CursorTokenEntry>): string => {
  const payload = entries.map((entry) => [entry.column, entry.direction, entry.value]);
  return CURSOR_TOKEN_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
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

/**
 * The cursor for a page ordered by anything besides `__auto_number` alone. Values are
 * read from the page's own SQL row, so the token carries what the ORDER BY compared —
 * independent of the client's field projection. Returns undefined when the row cannot
 * supply a value for every key, in which case no cursor may be advertised.
 */
export const buildCursorToken = (
  keys: ReadonlyArray<CursorSeekKey>,
  row: Record<string, unknown> | undefined
): string | undefined => {
  const values = readCursorKeyValues(keys, row);
  if (!values) {
    return undefined;
  }
  const token = encodeCursorToken(
    keys.map((key, index) => ({
      column: key.column,
      direction: key.direction,
      value: values[index] ?? null,
    }))
  );
  // Issuance and parsing share one size contract: a token long enough that we would
  // refuse to parse it must not be advertised, or the client would follow a cursor it
  // can never resume. Long sort values fall back to offset instead.
  return token.length > MAX_CURSOR_TOKEN_LENGTH ? undefined : token;
};

export const readCursorKeyValues = (
  keys: ReadonlyArray<CursorSeekKey>,
  row: Record<string, unknown> | undefined
): ReadonlyArray<CursorValue> | undefined => {
  if (!row) {
    return undefined;
  }
  const values: CursorValue[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const raw = row[cursorValueAlias(index)];
    if (raw === null) {
      values.push(null);
      continue;
    }
    if (!isCursorValue(raw)) {
      return undefined;
    }
    values.push(raw);
  }
  return values;
};

/**
 * Pair a token's values with the keys of the order currently in effect, position for
 * position. The token has to describe exactly this order: a key missing from it,
 * carrying another direction, left over from a wider order, or sitting at another
 * position would still match every current key while silently resuming from a position
 * this order does not have.
 */
export const resolveCursorValues = (
  keys: ReadonlyArray<CursorSeekKey>,
  entries: ReadonlyArray<CursorTokenEntry>
): ReadonlyArray<CursorValue> | undefined => {
  if (entries.length !== keys.length) {
    return undefined;
  }
  const values: CursorValue[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const entry = entries[index]!;
    if (entry.column !== key.column || entry.direction !== key.direction) {
      return undefined;
    }
    values.push(entry.value);
  }
  return values;
};

const cursorValueLiteral = (key: CursorSeekKey, value: CursorValue): RawBuilder<unknown> => {
  if (key.column === AUTO_NUMBER_COLUMN) {
    return sql`${value}::integer`;
  }
  if (key.column.startsWith(ROW_ORDER_COLUMN_PREFIX)) {
    return sql`${value}::double precision`;
  }
  return sql`${value}`;
};

/**
 * Seek past the row the cursor points at, comparing every order key against the value
 * the cursor carries. Mirrors the ORDER BY exactly, including v1's NULLS FIRST (asc)
 * and NULLS LAST (desc).
 *
 * The preferred shape is a row comparison `(k1, k2, …) > (v1, v2, …)`: PostgreSQL can
 * push that into the index as a start condition, so the page reads one page instead of
 * walking to it. It is exactly equivalent only while every key ascends and no boundary
 * value is null — under NULLS FIRST a null boundary belongs to a group the comparison
 * cannot express, and a descending key needs its own direction. Those shapes keep the
 * OR form below, which is correct but leaves the seek as a filter.
 */
export const buildValueSeekPredicate = (
  tableAlias: string,
  keys: ReadonlyArray<CursorSeekKey>,
  values: ReadonlyArray<CursorValue>
): RawBuilder<SqlBool> => {
  const columnRef = (column: string) => sql.ref(`${tableAlias}.${column}`);
  const valueAt = (index: number): CursorValue => values[index] ?? null;

  const rowComparison = (): RawBuilder<SqlBool> | undefined => {
    if (keys.length < 2) {
      return undefined;
    }
    if (!keys.every((key) => key.direction === 'asc')) {
      return undefined;
    }
    if (keys.some((_, index) => valueAt(index) === null)) {
      return undefined;
    }
    const left = sql.join(
      keys.map((key) => columnRef(key.column)),
      sql`, `
    );
    const right = sql.join(
      keys.map((key, index) => cursorValueLiteral(key, valueAt(index))),
      sql`, `
    );
    return sql`(${left}) > (${right})`;
  };

  const afterExpr = (key: CursorSeekKey, value: CursorValue): RawBuilder<SqlBool> | undefined => {
    const left = columnRef(key.column);
    if (!key.matchV1Nulls) {
      const right = cursorValueLiteral(key, value);
      return key.direction === 'asc' ? sql`${left} > ${right}` : sql`${left} < ${right}`;
    }
    if (key.direction === 'asc') {
      // NULLS FIRST: a null boundary is followed by every non-null row, and the rest of
      // the null group is settled by the later keys.
      return value === null
        ? sql`${left} is not null`
        : sql`${left} > ${cursorValueLiteral(key, value)}`;
    }
    // NULLS LAST: a null boundary has nothing after it; a non-null one is followed by
    // the smaller values and then every null row.
    return value === null
      ? undefined
      : sql`((${left} < ${cursorValueLiteral(key, value)}) or ${left} is null)`;
  };

  const prefixEquals = (key: CursorSeekKey, value: CursorValue): RawBuilder<SqlBool> => {
    const left = columnRef(key.column);
    return value === null
      ? sql`${left} is null`
      : sql`${left} is not distinct from ${cursorValueLiteral(key, value)}`;
  };

  const comparable = rowComparison();
  if (comparable) {
    return comparable;
  }

  const parts: RawBuilder<SqlBool>[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const after = afterExpr(key, valueAt(index));
    if (!after) {
      continue;
    }
    const equalsPrefix = keys
      .slice(0, index)
      .map((prefix, prefixIndex) => prefixEquals(prefix, valueAt(prefixIndex)));
    parts.push(sql`(${sql.join([...equalsPrefix, after], sql` and `)})`);
  }
  if (parts.length === 0) {
    return sql`false`;
  }
  return sql`(${sql.join(parts, sql` or `)})`;
};

export const isAutoNumberOnlyCursorOrderBy = (
  orderBy: ITableRecordQueryStreamOptions['orderBy']
): boolean => {
  if (!orderBy?.length) {
    return true;
  }

  return orderBy.every(
    (sort) =>
      isSystemColumnOrderBy(sort) && sort.column === AUTO_NUMBER_COLUMN && sort.direction === 'asc'
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

export const orderByHasAutoNumberAsc = (
  orderBy: ReadonlyArray<TableRecordOrderBy> | undefined
): boolean => {
  if (!orderBy?.length) {
    return true;
  }
  return orderBy.some(
    (sort) =>
      isSystemColumnOrderBy(sort) && sort.column === AUTO_NUMBER_COLUMN && sort.direction === 'asc'
  );
};
