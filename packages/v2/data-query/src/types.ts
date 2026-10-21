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
export type DataQueryFieldProjection = {
  fieldId: string;
  alias: string;
  /** Deduplicate multi-value lookup/rollup arrays in PostgreSQL, first occurrence order. */
  arrayDistinct?: boolean;
};
export type DataQuerySystemProjection = { system: DataQuerySystemField; alias: string };
/** A concrete sort target an allow-list may expose to a parameterized sort. */
export type DataQuerySortTarget = { fieldId: string } | { system: DataQuerySystemField };
export type DataQuerySort =
  | { fieldId: string; order: DataQuerySortOrder }
  | { system: DataQuerySystemField; order: DataQuerySortOrder }
  /** Aggregate output alias. Compiled to `ORDER BY <alias>` without re-evaluating the aggregate. */
  | { alias: string; order: DataQuerySortOrder }
  | {
      field: DataQueryParameterReference;
      order: DataQuerySortOrder | DataQueryParameterReference;
      /** Declared allow-list; a resolved value outside it is rejected, never interpolated. */
      allowed: DataQuerySortTarget[];
      /** Skip the whole item when its field or order parameter is absent. */
      optional?: boolean;
    };
/** Runtime sort items after parameter binding; only these reach SQL compilation. */
export type DataQuerySortResolved =
  | { fieldId: string; order: DataQuerySortOrder }
  | { system: DataQuerySystemField; order: DataQuerySortOrder }
  | { alias: string; order: DataQuerySortOrder };
export type DataQueryAggregate = {
  fieldId: string;
  statisticFunc: TableRecordAggregationFunction;
  alias: string;
};
type DataQueryDefinitionBase = {
  version: 1;
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
export type DataQueryDefinitionInput = DataQueryDefinitionBase &
  (
    | {
        kind: 'records';
        recordId?: string | DataQueryParameterReference;
        select: [
          DataQueryFieldProjection | DataQuerySystemProjection,
          ...(DataQueryFieldProjection | DataQuerySystemProjection)[],
        ];
      }
    | {
        kind: 'aggregate';
        aggregates: [DataQueryAggregate, ...DataQueryAggregate[]];
        groupBy?: DataQueryFieldProjection[];
      }
  );
export type BoundDataQuery = {
  readonly validatedDefinition: DataQueryDefinition;
  readonly definition: DataQueryDefinitionInput;
  readonly filter?: RecordFilter;
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
  | 'reference';
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
