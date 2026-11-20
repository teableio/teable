import { Buffer } from 'node:buffer';

import { domainError, type DomainError } from '@teable/v2-core';
import {
  decodeDataQueryCursor,
  encodeDataQueryCursor,
  type BoundDataQuery,
  type DataQueryResult,
} from '@teable/v2-data-query';
import type { IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type CompiledQuery, type Kysely, type RawBuilder } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { finalizeValue, type ProjectionStorageType } from './compileDistinctRecords';

type Row = Record<string, unknown>;
export type CursorOrder = {
  expression: RawBuilder<unknown>;
  alias?: string;
  direction: 'asc' | 'desc';
  nulls: 'first' | 'last';
};
type CursorProjection = {
  alias: string;
  expression: RawBuilder<unknown>;
  metric: boolean;
  /** Exact stored SQL type; computed and legacy numeric-family values stay unknown. */
  storageType?: ProjectionStorageType;
};
export type CursorColumns = {
  binding: string;
  valuesColumn: string;
  idColumn: string;
  publicAliases: readonly string[];
  normalizePublicJson: boolean;
  nativeValues: boolean;
};

// JSON drivers already round finite numeric leaves. Copy only changed containers
// when overflow or negative underflow needs the canonical null/positive zero.
const normalizeCursorPublicJson = (value: unknown): unknown => {
  if (typeof value === 'number') return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
  if (Array.isArray(value)) {
    let output: unknown[] | undefined;
    for (let index = 0; index < value.length; index++) {
      const normalized = normalizeCursorPublicJson(value[index]);
      if (!Object.is(normalized, value[index])) {
        output ??= value.slice();
        output[index] = normalized;
      }
    }
    return output ?? value;
  }
  if (value !== null && typeof value === 'object') {
    let output: Row | undefined;
    for (const key of Object.keys(value)) {
      const item = (value as Row)[key];
      const normalized = normalizeCursorPublicJson(item);
      if (!Object.is(normalized, item)) {
        output ??= { ...value };
        Object.defineProperty(output, key, {
          value: normalized,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return output ?? value;
  }
  return value;
};

/**
 * V7 finalizes DISTINCT before deduplication and ordinary public values after paging.
 * Ordinary records retain V6's native SQL order and collation for every sort key.
 */
export const compileCursorRecords = (
  db: Kysely<V1TeableDatabase>,
  from: RawBuilder<unknown>,
  projections: readonly CursorProjection[],
  id: RawBuilder<unknown>,
  requestedOrders: readonly CursorOrder[],
  distinct: boolean,
  query: BoundDataQuery,
  binding: string,
  strategy: IPgTypeValidationStrategy,
  cursorPublicNormalization: 'sql' | 'driver',
  cursorSigningKey: string | undefined,
  deferRemainingRows = false
) => {
  if (!cursorSigningKey)
    return err(
      domainError.infrastructure({
        code: 'data_query.cursor_not_configured',
        message: 'Data query cursor signing is not configured',
      })
    );
  const decoded = decodeDataQueryCursor(query.cursor?.after, binding, cursorSigningKey);
  if (decoded.isErr()) return err(decoded.error);
  const aliases = new Map(projections.map((projection, index) => [projection.alias, `p${index}`]));
  const orders = [...requestedOrders];
  if (distinct) {
    for (const projection of projections) {
      if (!orders.some((order) => order.alias === projection.alias))
        orders.push({
          alias: projection.alias,
          expression: projection.expression,
          direction: 'asc',
          nulls: 'first',
        });
    }
  }
  const selected = projections.map(
    (projection, index) => sql`${projection.expression} as ${sql.id(`p${index}`)}`
  );
  orders.forEach((order, index) => {
    if (!order.alias) selected.push(sql`${order.expression} as ${sql.id(`s${index}`)}`);
  });
  selected.push(sql`${id} as ${sql.id('record_id')}`);
  const projected = sql`select ${sql.join(selected)} ${from}`;
  let tuples = projected;
  if (distinct) {
    const finalized = projections.map((projection, index) => {
      const value = sql.id('projected', `p${index}`);
      return sql`${finalizeValue(value, projection.metric, strategy, 'sql', projection.storageType)} as ${sql.id(`p${index}`)}`;
    });
    finalized.push(sql`${sql.id('projected', 'record_id')} as ${sql.id('record_id')}`);
    const finalizedRows = sql`select ${sql.join(finalized)} from (${projected} offset 0) as ${sql.id('projected')}`;
    const tupleColumns = projections.map((_, index) => sql.id(`p${index}`));
    // Root identity never participates in DISTINCT equality; it only breaks ties
    // after the complete finalized public tuple has been selected.
    tuples = sql`select ${sql.join(tupleColumns)}, min(${sql.id('record_id')} collate "C") as ${sql.id('record_id')} from (${finalizedRows}) as ${sql.id('finalized')} group by ${sql.join(tupleColumns)}`;
  }
  const position = decoded.value;
  if (
    position &&
    (position.values.length !== orders.length ||
      position.values.some(
        (value) =>
          value !== null && typeof value !== 'string' && (distinct || typeof value !== 'boolean')
      ))
  )
    return err(
      domainError.validation({
        code: 'data_query.invalid_cursor',
        message: 'Cursor sort tuple does not match the query',
      })
    );
  const values = orders.map((order, index) => {
    const column = order.alias ? aliases.get(order.alias) : `s${index}`;
    if (!column) throw new Error('A cursor sort alias is not selected');
    return sql.id('tuples', column);
  });
  const parts = (value: RawBuilder<unknown>) =>
    distinct
      ? [
          sql`(case when ${value} is null then null when jsonb_typeof(${value}) = 'string' then 'string' else 'value' end) collate "C"`,
          sql`(case when jsonb_typeof(${value}) = 'string' then ${value} #>> '{}' end) collate "C"`,
          sql`(case when jsonb_typeof(${value}) <> 'string' then ${value} end)`,
        ]
      : [value];
  const afterValue = (index: number) =>
    distinct ? sql`${position!.values[index]}::jsonb` : sql`${position!.values[index]}`;
  const recordId = distinct
    ? sql`${sql.id('tuples', 'record_id')} collate "C"`
    : sql.id('tuples', 'record_id');
  const afterId = position && (distinct ? sql`${position.id} collate "C"` : sql`${position.id}`);
  const afterPredicate = (startIndex = 0) => {
    if (!position) return sql`true`;
    const comparisons: RawBuilder<unknown>[] = [];
    for (let index = startIndex; index < orders.length; index++) {
      const order = orders[index];
      const valueParts = parts(values[index]);
      const afterParts = parts(afterValue(index));
      valueParts.forEach((value, partIndex) => {
        const after = afterParts[partIndex];
        const unequal = sql`(${value} ${sql.raw(order.direction === 'asc' ? '>' : '<')} ${after})`;
        const later = !distinct
          ? position.values[index] === null
            ? sql`${order.nulls === 'first'} and ${value} is not null`
            : order.nulls === 'last'
              ? sql`(${value} is null or ${unequal})`
              : unequal
          : order.nulls === 'first'
            ? sql`((${after} is null and ${value} is not null) or ${unequal})`
            : sql`((${after} is not null and ${value} is null) or ${unequal})`;
        // Only equal keys advance. False (including SQL-NULL comparisons)
        // terminates at the first unequal key. COALESCE is a flat conditional
        // construct, avoiding deep SQL trees and repeated equality prefixes.
        comparisons.push(
          sql`case when ${value} is not distinct from ${after} then null else (${later}) is true end`
        );
      });
    }
    comparisons.push(sql`${recordId} > ${afterId}`);
    return comparisons.length === 1 ? comparisons[0] : sql`coalesce(${sql.join(comparisons)})`;
  };
  const ordering: RawBuilder<unknown>[] = [];
  orders.forEach((order, index) => {
    const valueParts = parts(values[index]);
    valueParts.forEach((value) =>
      ordering.push(sql`${value} ${sql.raw(order.direction)} ${sql.raw(`nulls ${order.nulls}`)}`)
    );
  });
  ordering.push(sql`${recordId} asc`);
  const publicAliases = new Set(projections.map((projection) => projection.alias));
  const privateAlias = (base: string) => {
    let name = base;
    while (publicAliases.has(name)) name += '_';
    publicAliases.add(name);
    return name;
  };
  const cursor: CursorColumns = {
    binding,
    valuesColumn: privateAlias('__dq_cursor_values'),
    idColumn: privateAlias('__dq_cursor_id'),
    publicAliases: projections.map((projection) => projection.alias),
    normalizePublicJson: !distinct && cursorPublicNormalization === 'driver',
    nativeValues: !distinct,
  };
  const output = projections.map((projection, index) => {
    const value = sql.id('tuples', `p${index}`);
    // The driver path already returns these native public scalar shapes. Exact
    // numerics must stay strings; INTEGER and legacy REAL cannot inherit bigint
    // or float behavior from the cursor sort's broader storage families.
    const storageType = projection.storageType;
    const publicValue = distinct
      ? value
      : cursorPublicNormalization === 'driver' && !projection.metric && storageType
        ? storageType === 'numeric' || storageType === 'bigint'
          ? sql`(${value})::text`
          : value
        : finalizeValue(value, projection.metric, strategy, cursorPublicNormalization, storageType);
    return sql`${publicValue} as ${sql.id(projection.alias)}`;
  });
  // record_send preserves float bits independently of extra_float_digits, even
  // for arrays. CASE never casts polymorphic sort expressions to an invalid type.
  const cursorValues = sql`to_jsonb(array[${sql.join(
    values.map((value) =>
      distinct
        ? sql`(${value})::text`
        : sql`case
            when pg_typeof(${value})::text = 'boolean' then 'bool:' || (${value})::text
            when pg_typeof(${value})::text in ('real', 'double precision', 'real[]', 'double precision[]')
              then 'b:' || encode(record_send(row(${value})), 'hex')
            else 'p:' || (${value})::text end`
    )
  )}]::text[])`;
  const candidates = distinct ? sql`${tuples} offset 0` : tuples;
  const nativeCandidates = !distinct;
  const candidateTable = sql.id('__dq_cursor_candidates');
  const candidateSource = nativeCandidates ? candidateTable : sql`(${candidates})`;
  const orderedBranch = (
    predicate: RawBuilder<unknown>,
    branchOrdering: readonly RawBuilder<unknown>[] = ordering,
    source: RawBuilder<unknown> = candidateSource
  ) =>
    sql`select * from ${source} as ${sql.id('tuples')} where ${predicate} order by ${sql.join(branchOrdering)} limit ${query.limit + 1}`;
  // These lanes are disjoint and already in canonical first-key order. Only
  // request the remaining page from later lanes. Keep the constant inner LIMIT
  // so PostgreSQL costs each index seek as a page, not a fraction of the table.
  const demandPage = (
    lanes: readonly RawBuilder<unknown>[],
    definitions: readonly RawBuilder<unknown>[] = [],
    capacity = query.limit + 1
  ) => {
    if (lanes.length === 1) {
      const lane =
        capacity === query.limit + 1
          ? lanes[0]
          : sql`select * from (${lanes[0]}) as ${sql.id('tuples')} limit ${capacity}`;
      return definitions.length ? sql`with ${sql.join(definitions)} ${lane}` : lane;
    }
    const names = lanes.map((_, index) => sql.id(`__dq_page_${index}`));
    const counts =
      lanes.length > 3 ? lanes.map((_, index) => sql.id(`__dq_used_${index}`)) : undefined;
    const pages: RawBuilder<unknown>[] = [];
    lanes.forEach((lane, index) => {
      const previous = !index
        ? sql`0`
        : lanes.length <= 3
          ? sql`${sql.join(
              names.slice(0, index).map((name) => sql`(select count(*) from ${name})`),
              sql` + `
            )}`
          : sql`(select used from ${counts![index - 1]})`;
      const remaining = index ? sql`greatest(0, ${capacity} - (${previous}))` : sql`${capacity}`;
      pages.push(
        sql`${names[index]} as materialized (select * from (${lane}) as ${sql.id('tuples')} limit ${remaining})`
      );
      if (lanes.length > 3 && index + 1 < lanes.length)
        pages.push(
          sql`${counts![index]} as materialized (select ${previous} + (select count(*) from ${names[index]}) as used)`
        );
    });
    // The remaining-count limits already bound the disjoint union to one page.
    // Its caller applies the canonical ORDER BY after public projection; sorting
    // here as well can make PostgreSQL sort the same bounded page twice.
    return sql`with ${sql.join([...definitions, ...pages])} select * from (${sql.join(
      names.map((name) => sql`select * from ${name}`),
      sql` union all `
    )}) as ${sql.id('tuples')}`;
  };
  // A native btree can contain at most 32 attributes. Expose every indexable
  // suffix (reserving the ID attribute), then retain the flat exact predicate
  // beyond that prefix. Hundreds of sorts therefore cannot explode the planner.
  const nativeSuffix = (firstPredicate: RawBuilder<unknown>) => {
    const definitions: RawBuilder<unknown>[] = [];
    let source = sql.id('__dq_equal_0');
    definitions.push(
      sql`${source} as not materialized (select * from ${candidateTable} as tuples where ${firstPredicate})`
    );
    const groups: RawBuilder<unknown>[][] = [];
    const end = Math.min(orders.length, 31);
    let index = 1;
    let complete = false;
    while (index < end) {
      const order = orders[index];
      let next = index + 1;
      // NULLS FIRST runs with non-NULL boundaries can use one row comparison:
      // a NULL encountered at an equal prefix precedes the cursor and is excluded.
      if (position!.values[index] !== null && order.nulls === 'first') {
        while (
          next < end &&
          orders[next].direction === order.direction &&
          orders[next].nulls === 'first' &&
          position!.values[next] !== null
        )
          next++;
      }
      const runValues = values.slice(index, next);
      const runAfter = runValues.map((_, offset) => afterValue(index + offset));
      const appendId =
        next === orders.length &&
        order.direction === 'asc' &&
        order.nulls === 'first' &&
        position!.values[index] !== null;
      const lanes: RawBuilder<unknown>[] = [];
      if (position!.values[index] === null) {
        if (order.nulls === 'first')
          lanes.push(orderedBranch(sql`${values[index]} is not null`, ordering, source));
      } else {
        if (appendId) {
          runValues.push(recordId);
          runAfter.push(afterId!);
        }
        const range =
          runValues.length === 1
            ? sql`${runValues[0]} ${sql.raw(order.direction === 'asc' ? '>' : '<')} ${runAfter[0]}`
            : sql`(${sql.join(runValues)}) ${sql.raw(order.direction === 'asc' ? '>' : '<')} (${sql.join(runAfter)})`;
        lanes.push(orderedBranch(range, ordering, source));
        if (order.nulls === 'last')
          lanes.push(orderedBranch(sql`${values[index]} is null`, ordering, source));
      }
      groups.push(lanes);
      if (appendId) {
        complete = true;
        break;
      }
      const equal = values
        .slice(index, next)
        .map((value, offset) =>
          position!.values[index + offset] === null
            ? sql`${value} is null`
            : sql`${value} = ${afterValue(index + offset)}`
        );
      const equalSource = sql.id(`__dq_equal_${next}`);
      definitions.push(
        sql`${equalSource} as not materialized (select * from ${source} as tuples where ${sql.join(equal, sql` and `)})`
      );
      source = equalSource;
      index = next;
    }
    const lanes = complete ? [] : [orderedBranch(afterPredicate(index), ordering, source)];
    for (let group = groups.length - 1; group >= 0; group--) lanes.push(...groups[group]);
    return demandPage(lanes, definitions);
  };
  let page: RawBuilder<unknown>;
  const pageOrdering = ordering;
  let compileRemainingRows: ((remaining: number) => CompiledQuery<Row>) | undefined;
  const compileRows = (
    rows: RawBuilder<unknown>,
    boundary = query.limit,
    rowOrdering: readonly RawBuilder<unknown>[] = ordering
  ) => {
    // Rank only the already bounded page, using the exact canonical keys and
    // ID that order the result. Keep public finalization outside this window.
    const rankedRows =
      boundary > 0
        ? sql`select *, row_number() over (order by ${sql.join(rowOrdering)}) as ${sql.id('__dq_cursor_ordinal')} from (${rows}) as ${sql.id('tuples')}`
        : rows;
    const isBoundary = sql`${sql.id('tuples', '__dq_cursor_ordinal')} = ${boundary}`;
    const privateOutput = [
      sql`${boundary > 0 ? sql`case when ${isBoundary} then ${cursorValues} end` : sql`null`} as ${sql.id(cursor.valuesColumn)}`,
      sql`${boundary > 0 ? sql`case when ${isBoundary} then ${sql.id('tuples', 'record_id')} end` : sql`null`} as ${sql.id(cursor.idColumn)}`,
    ];
    return sql<Row>`${nativeCandidates ? sql`with ${candidateTable} as not materialized (${candidates})` : sql``} select ${sql.join([...output, ...privateOutput])} from (${rankedRows}) as ${sql.id('tuples')} order by ${sql.join(rowOrdering)}`.compile(
      db
    );
  };
  const firstOrder = orders[0];
  if (position && !distinct && firstOrder) {
    const value = values[0];
    const nullGroup = () => [
      position.values[0] === null && orders.length > 1
        ? nativeSuffix(sql`${value} is null`)
        : orderedBranch(
            sql`${value} is null and ${position.values[0] === null ? afterPredicate(1) : sql`true`}`
          ),
    ];
    const nonNullGroup = () => {
      if (position.values[0] === null) return [orderedBranch(sql`${value} is not null`)];
      const after = afterValue(0);
      if (orders.length === 1 && firstOrder.direction === 'asc') {
        // Both index keys advance in the same direction, so one row comparison
        // includes equal-value ID ties and later values in a single index seek.
        return [orderedBranch(sql`(${value}, ${recordId}) > (${after}, ${afterId})`)];
      }
      const lanes = [
        orders.length === 1
          ? orderedBranch(sql`${value} = ${after} and ${afterPredicate(1)}`)
          : nativeSuffix(sql`${value} = ${after}`),
        orderedBranch(
          sql`${value} ${sql.raw(firstOrder.direction === 'asc' ? '>' : '<')} ${after}`
        ),
      ];
      if (orders.length === 1) {
        // The two native ranges share the complete key/ID order. Let PostgreSQL
        // merge their bounded index streams rather than materializing pages and
        // counting the equal range before starting the strict range.
        return [
          sql`select * from (${sql.join(
            lanes.map((lane) => sql`(${lane})`),
            sql` union all `
          )}) as tuples order by ${sql.join(ordering)} limit ${query.limit + 1}`,
        ];
      }
      // Equal-key ties precede the strict range, including DESC with ASC IDs.
      // Demand only the remaining rows; avoid reading and sorting two full pages.
      return lanes;
    };
    const groups: Array<() => RawBuilder<unknown>[]> = [];
    if (position.values[0] === null) {
      groups.push(nullGroup);
      if (firstOrder.nulls === 'first') groups.push(nonNullGroup);
    } else {
      groups.push(nonNullGroup);
      if (firstOrder.nulls === 'last') groups.push(nullGroup);
    }
    if (deferRemainingRows && groups.length > 1) {
      page = demandPage(groups[0]());
      compileRemainingRows = (remaining) =>
        compileRows(demandPage(groups[1](), [], remaining), remaining - 1);
    } else {
      page = demandPage(groups.flatMap((group) => group()));
    }
  } else {
    const keyset = position ? sql`where ${afterPredicate()}` : sql``;
    page = sql`select * from ${candidateSource} as ${sql.id('tuples')} ${keyset} order by ${sql.join(ordering)} limit ${query.limit + 1}`;
  }
  return ok({
    rows: compileRows(page, query.limit, pageOrdering),
    ...(compileRemainingRows ? { compileRemainingRows } : {}),
    ...(query.includeTotal
      ? {
          count: sql<{
            total: unknown;
          }>`select count(*) as total ${distinct ? sql`from (${tuples}) as ${sql.id('counted')}` : from}`.compile(
            db
          ),
        }
      : {}),
    cursor,
  });
};

// PostgreSQL's record binary format contains one typed field. Float arrays carry
// dimensions, lower bounds and nullable elements; preserve all of them on replay.
const decodeNativeCursorValue = (value: string | null): string | boolean | null => {
  if (value === null) return null;
  if (value.startsWith('p:')) return value.slice(2);
  if (value === 'bool:false') return false;
  if (value === 'bool:true') return true;
  if (!value.startsWith('b:')) throw new Error('Invalid native cursor value');
  const bytes = Buffer.from(value.slice(2), 'hex');
  const type = bytes.readUInt32BE(4);
  if (bytes.readInt32BE(8) === -1) return null;
  if (type === 700 || type === 701)
    return String(type === 700 ? bytes.readFloatBE(12) : bytes.readDoubleBE(12));
  const dimensions = bytes.readInt32BE(12);
  const elementType = bytes.readUInt32BE(20);
  if ((type !== 1021 && type !== 1022) || (elementType !== 700 && elementType !== 701))
    throw new Error('Invalid native float array');
  if (dimensions === 0) return '{}';
  const lengths: number[] = [];
  const bounds: string[] = [];
  let explicitBounds = false;
  let offset = 24;
  for (let index = 0; index < dimensions; index++) {
    const length = bytes.readInt32BE(offset);
    const lower = bytes.readInt32BE(offset + 4);
    lengths.push(length);
    bounds.push(`[${lower}:${lower + length - 1}]`);
    explicitBounds ||= lower !== 1;
    offset += 8;
  }
  const array = (dimension: number): string => {
    const elements = new Array<string>(lengths[dimension]);
    for (let index = 0; index < elements.length; index++) {
      if (dimension + 1 < dimensions) {
        elements[index] = array(dimension + 1);
        continue;
      }
      const length = bytes.readInt32BE(offset);
      offset += 4;
      elements[index] =
        length === -1
          ? 'NULL'
          : String(elementType === 700 ? bytes.readFloatBE(offset) : bytes.readDoubleBE(offset));
      if (length !== -1) offset += length;
    }
    return `{${elements.join(',')}}`;
  };
  return `${explicitBounds ? `${bounds.join('')}=` : ''}${array(0)}`;
};

/** The lookahead row is never exposed and cursor-only columns cannot leak. */
export const finishCursorRecords = (
  rows: readonly Row[],
  query: BoundDataQuery,
  cursor: CursorColumns,
  total: number | undefined,
  cursorSigningKey: string | undefined
): Result<DataQueryResult, DomainError> => {
  if (!cursorSigningKey)
    return err(
      domainError.infrastructure({
        code: 'data_query.cursor_not_configured',
        message: 'Data query cursor signing is not configured',
      })
    );
  const pageLength = Math.min(rows.length, query.limit);
  const last = rows[pageLength - 1];
  let nextCursor: string | null = null;
  if (rows.length > query.limit && last) {
    const values = last[cursor.valuesColumn];
    const id = last[cursor.idColumn];
    if (!Array.isArray(values) || typeof id !== 'string')
      return err(
        domainError.infrastructure({
          code: 'data_query.execution_failed',
          message: 'Unable to resolve the data query cursor',
        })
      );
    const encoded = encodeDataQueryCursor(
      cursor.binding,
      {
        values: cursor.nativeValues ? values.map(decodeNativeCursorValue) : values,
        id,
      },
      cursorSigningKey
    );
    if (encoded.isErr()) return err(encoded.error);
    nextCursor = encoded.value;
  }
  const publicRows = new Array<Row>(pageLength);
  for (let index = 0; index < pageLength; index++) {
    const row = rows[index];
    const output: Row = {};
    for (const alias of cursor.publicAliases) {
      const value = row[alias];
      output[alias] = cursor.normalizePublicJson ? normalizeCursorPublicJson(value) : value;
    }
    publicRows[index] = output;
  }
  return ok({
    rows: publicRows,
    page: { limit: query.limit, nextCursor, ...(total === undefined ? {} : { total }) },
  });
};
