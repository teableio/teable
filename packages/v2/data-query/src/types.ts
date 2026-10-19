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
export type DataQueryFilter =
  | { conjunction: 'and' | 'or'; items: DataQueryFilter[] }
  | { not: DataQueryFilter }
  | {
      fieldId: string;
      operator: RecordFilterOperator;
      value: RecordFilterValue | DataQueryParameterReference;
    };
export type DataQuerySystemField =
  | 'id'
  | 'createdTime'
  | 'lastModifiedTime'
  | 'autoNumber'
  | 'version';
export type DataQueryFieldProjection = { fieldId: string; alias: string };
export type DataQuerySystemProjection = { system: DataQuerySystemField; alias: string };
export type DataQuerySort =
  | { fieldId: string; order: 'asc' | 'desc' }
  | { system: DataQuerySystemField; order: 'asc' | 'desc' };
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
