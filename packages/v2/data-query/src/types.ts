import type {
  RecordFilter,
  RecordFilterOperator,
  RecordFilterValue,
  TableRecordAggregationFunction,
} from '@teable/v2-core';
import type { DataQueryDefinition } from './DataQueryDefinition';

export type DataQueryParameterReference = { type: 'parameter'; name: string };
export type DataQueryParameterDefinition = {
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'date';
  nullable?: boolean;
  default?: RecordFilterValue;
};
/** Explicit sort-order values. A parameterized order may only resolve to one of these. */
export type DataQuerySortOrder = 'asc' | 'desc';
/** Explicit null placement; omitted keeps the compiler's existing per-field default. */
export type DataQuerySortNulls = 'first' | 'last';
export type DataQueryFilterLeaf = {
  fieldId: string;
  operator: RecordFilterOperator;
  value: RecordFilterValue | DataQueryParameterReference;
  /** Skip this leaf when its parameter is absent. Literal values cannot be optional. */
  optional?: boolean;
};
export type DataQueryFilter =
  | { conjunction: 'and' | 'or'; items: DataQueryFilter[] }
  | { not: DataQueryFilter }
  | DataQueryFilterLeaf;
export type DataQuerySystemField =
  | 'id'
  | 'createdTime'
  | 'lastModifiedTime'
  | 'autoNumber'
  | 'version';
/** A controlled bucket applied to a stored field; never a raw SQL expression. */
export type DataQueryBucketRangeUnit = 'day' | 'month';
export type DataQueryBucketEdge = { maxExclusive: number; label: string };
export type DataQueryBucket =
  | {
      kind: 'dateTrunc';
      unit: 'day' | 'week' | 'month' | 'quarter' | 'year';
      /** IANA zone used to resolve the calendar boundary; output is a local date string. */
      timeZone: string;
    }
  | {
      kind: 'numericRange';
      /** Ascending exclusive upper bounds; the first matching edge wins. */
      edges: [DataQueryBucketEdge, ...DataQueryBucketEdge[]];
      fallbackLabel: string;
      /** Emitted for a null stored value; omitted keeps null. */
      nullLabel?: string;
    }
  | {
      kind: 'dateDifferenceRange';
      unit: DataQueryBucketRangeUnit;
      timeZone: string;
      /** Local calendar date used as "today"; omitted means the current date in `timeZone`. */
      anchor?: string;
      /** Ascending exclusive bounds on `anchor - value`, so past values are positive. */
      edges: [DataQueryBucketEdge, ...DataQueryBucketEdge[]];
      fallbackLabel: string;
      nullLabel?: string;
    };
export type DataQueryFieldProjection = {
  fieldId: string;
  alias: string;
  /** Deduplicate multi-value lookup/rollup arrays in PostgreSQL, first occurrence order. */
  arrayDistinct?: boolean;
};
export type DataQuerySystemProjection = { system: DataQuerySystemField; alias: string };
/** A concrete sort target an allow-list may expose to a parameterized sort. */
export type DataQuerySortTarget =
  | { fieldId: string }
  | { system: DataQuerySystemField }
  | { source: string; fieldId: string }
  | { source: string; system: DataQuerySystemField };
export type DataQuerySort =
  | { fieldId: string; order: DataQuerySortOrder; nulls?: DataQuerySortNulls }
  | { system: DataQuerySystemField; order: DataQuerySortOrder; nulls?: DataQuerySortNulls }
  /** Sort by a declared relation source; the SQL orders by the joined target column. */
  | { source: string; fieldId: string; order: DataQuerySortOrder; nulls?: DataQuerySortNulls }
  | {
      source: string;
      system: DataQuerySystemField;
      order: DataQuerySortOrder;
      nulls?: DataQuerySortNulls;
    }
  /** Aggregate output alias. Compiled to `ORDER BY <alias>` without re-evaluating the aggregate. */
  | { alias: string; order: DataQuerySortOrder; nulls?: DataQuerySortNulls }
  | {
      field: DataQueryParameterReference;
      order: DataQuerySortOrder | DataQueryParameterReference;
      /** Declared allow-list; a resolved value outside it is rejected, never interpolated. */
      allowed: DataQuerySortTarget[];
      /** Skip the whole item when its field or order parameter is absent. */
      optional?: boolean;
      nulls?: DataQuerySortNulls;
    };
/** Runtime sort items after parameter binding; only these reach SQL compilation. */
export type DataQuerySortResolved =
  | { fieldId: string; order: DataQuerySortOrder; nulls?: DataQuerySortNulls }
  | { system: DataQuerySystemField; order: DataQuerySortOrder; nulls?: DataQuerySortNulls }
  | { source: string; fieldId: string; order: DataQuerySortOrder; nulls?: DataQuerySortNulls }
  | {
      source: string;
      system: DataQuerySystemField;
      order: DataQuerySortOrder;
      nulls?: DataQuerySortNulls;
    }
  | { alias: string; order: DataQuerySortOrder; nulls?: DataQuerySortNulls };
export type DataQueryAggregate = {
  fieldId: string;
  statisticFunc: TableRecordAggregationFunction;
  alias: string;
};
/** The statistics a to-many relation aggregate may compute. */
export type DataQueryRelationStatistic = 'count' | 'unique' | 'sum' | 'average' | 'min' | 'max';
/**
 * One aggregate over a to-many relation, computed per root row in a pre-aggregated
 * lateral join. `count` alone omits `fieldId` and counts related target records; every
 * other statistic requires a stored target field.
 */
export type DataQueryRelationAggregate = {
  source: string;
  fieldId?: string;
  statisticFunc: DataQueryRelationStatistic;
  alias: string;
};
type DataQueryDefinitionBase = {
  tableId: string;
  parameters?: Record<string, DataQueryParameterDefinition>;
  filter?: DataQueryFilter;
  page?: {
    limit: number | DataQueryParameterReference;
    offset?: number | DataQueryParameterReference;
    /** Opt-in: also return the unpaginated total for the same scope and filters. */
    includeTotal?: boolean;
  };
  sort?: DataQuerySort[];
};
export type DataQueryRelation = {
  /** Stable Link field on the root table, or on the `via` relation's target table. */
  linkFieldId: string;
  /** Declared target table; checked against the Link metadata when tables load. */
  tableId: string;
  /**
   * Target-side predicate, compiled into this hop's join condition. A row whose
   * target misses the predicate keeps its null target columns instead of disappearing.
   */
  filter?: DataQueryFilter;
  /**
   * Alias of an earlier to-one relation whose target table hosts `linkFieldId`.
   * Omitted means the root table. This is how a second or third hop is declared.
   */
  via?: string;
};
export type DataQuerySourceRef = {
  /** Omitted means root. `root` is reserved and may also be written explicitly. */
  source?: string;
};
export type DataQueryFieldProjectionV2 = DataQueryFieldProjection &
  DataQuerySourceRef & {
    /** Derived date/numeric bucket; controlled options only, never an expression. */
    bucket?: DataQueryBucket;
  };
export type DataQuerySystemProjectionV2 = DataQuerySystemProjection & DataQuerySourceRef;
export type DataQueryRecordsProjection =
  | DataQueryFieldProjection
  | DataQuerySystemProjection
  | DataQueryFieldProjectionV2
  | DataQuerySystemProjectionV2
  | DataQueryRelationAggregate;
export type DataQueryDefinitionInput = (
  | (DataQueryDefinitionBase & { version: 1 })
  | (DataQueryDefinitionBase & {
      version: 2;
      relations?: Record<string, DataQueryRelation>;
    })
) &
  (
    | {
        kind: 'records';
        recordId?: string | DataQueryParameterReference;
        select: [DataQueryRecordsProjection, ...DataQueryRecordsProjection[]];
      }
    | {
        kind: 'aggregate';
        aggregates: [DataQueryAggregateEntry, ...DataQueryAggregateEntry[]];
        groupBy?: (DataQueryFieldProjection | DataQueryFieldProjectionV2)[];
      }
  );
/**
 * A grouped report combines root-field statistics with to-many relation metrics.
 * A relation metric uses the records projection shape, so one parser validates
 * both kinds; a strict-object union keeps `source` unambiguous.
 */
export type DataQueryAggregateEntry = DataQueryAggregate | DataQueryRelationAggregate;
export type BoundDataQuery = {
  readonly validatedDefinition: DataQueryDefinition;
  readonly definition: DataQueryDefinitionInput;
  readonly filter?: RecordFilter;
  /** Resolved relation filters, keyed by relation alias. */
  readonly relationFilters?: Readonly<Record<string, RecordFilter>>;
  readonly recordId?: string;
  readonly limit: number;
  readonly offset: number;
  /** Fully resolved sorts: parameterized items are replaced by validated concrete targets. */
  readonly sort: ReadonlyArray<DataQuerySortResolved>;
  readonly includeTotal: boolean;
};
export type DataQueryFieldUsage =
  | 'projection'
  | 'filter'
  | 'sort'
  | 'group'
  | 'aggregate'
  | 'reference'
  | 'relation';
export type DataQueryFieldDependency = {
  readonly fieldId: string;
  readonly usages: ReadonlyArray<DataQueryFieldUsage>;
  readonly fieldType: string;
  readonly cellValueType: string;
  readonly isMultipleCellValue: boolean;
};
export type DataQueryOutput = {
  readonly alias: string;
  /** Wire representation, not the formula/semantic cell value type. Unknown covers the entire JSON value. */
  readonly wireType: 'string' | 'numberOrString' | 'boolean' | 'unknown';
  readonly cellValueType: string;
  readonly isMultipleCellValue: boolean;
  readonly nullable: boolean;
};
