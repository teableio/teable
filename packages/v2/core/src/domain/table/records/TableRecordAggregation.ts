import type { FieldId } from '../fields/FieldId';

export const tableRecordAggregationFunctionValues = [
  'count',
  'empty',
  'filled',
  'unique',
  'max',
  'min',
  'sum',
  'average',
  'checked',
  'unChecked',
  'percentEmpty',
  'percentFilled',
  'percentUnique',
  'percentChecked',
  'percentUnChecked',
  'earliestDate',
  'latestDate',
  'dateRangeOfDays',
  'dateRangeOfMonths',
  'totalAttachmentSize',
] as const;

export type TableRecordAggregationFunction = (typeof tableRecordAggregationFunctionValues)[number];

export type TableRecordAggregationFieldInput = {
  readonly fieldId: string;
  readonly statisticFunc: string;
};

export type TableRecordAggregationField = {
  readonly fieldId: FieldId;
  readonly statisticFunc: TableRecordAggregationFunction;
};

export type TableRecordAggregationGroupInput = {
  readonly fieldId: string;
  readonly order: 'asc' | 'desc';
};

export type TableRecordAggregationGroup = {
  readonly fieldId: FieldId;
  readonly fieldType: string;
  readonly order: 'asc' | 'desc';
};

export class TableRecordAggregation {
  private constructor(
    readonly fields: ReadonlyArray<TableRecordAggregationField>,
    readonly groupBy: ReadonlyArray<TableRecordAggregationGroup>
  ) {}

  static create(
    fields: ReadonlyArray<TableRecordAggregationField>,
    groupBy: ReadonlyArray<TableRecordAggregationGroup>
  ): TableRecordAggregation {
    return new TableRecordAggregation([...fields], [...groupBy]);
  }
}
