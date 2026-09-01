import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { Field } from '../fields/Field';
import { FieldValueTypeVisitor } from '../fields/visitors/FieldValueTypeVisitor';
import {
  TableRecordAggregation,
  type TableRecordAggregationField,
  type TableRecordAggregationFieldInput,
  type TableRecordAggregationFunction,
  type TableRecordAggregationGroup,
  type TableRecordAggregationGroupInput,
  tableRecordAggregationFunctionValues,
} from '../records/TableRecordAggregation';
import type { Table } from '../Table';

export type CreateRecordAggregationParams = {
  readonly viewId?: string;
  readonly fields?: ReadonlyArray<TableRecordAggregationFieldInput>;
  readonly groupBy?: ReadonlyArray<TableRecordAggregationGroupInput>;
  readonly includeHiddenFields?: boolean;
};

const commonFunctions: ReadonlyArray<TableRecordAggregationFunction> = [
  'count',
  'empty',
  'filled',
  'unique',
  'percentEmpty',
  'percentFilled',
  'percentUnique',
];

const validFunctionsForField = (
  field: Field
): Result<ReadonlySet<TableRecordAggregationFunction>, DomainError> => {
  return safeTry(function* () {
    const fieldType = field.type().toString();
    // Keep aggregation validity tied to the Field child rather than HTTP DTO metadata.
    const valueType = yield* field.accept(new FieldValueTypeVisitor());
    const isMultiple = valueType.isMultipleCellValue.toBoolean();
    let values: ReadonlyArray<TableRecordAggregationFunction>;

    if (fieldType === 'link') {
      values = ['count', 'empty', 'filled', 'percentEmpty', 'percentFilled'];
    } else if (['user', 'createdBy', 'lastModifiedBy'].includes(fieldType)) {
      values = isMultiple
        ? ['count', 'empty', 'filled', 'percentEmpty', 'percentFilled']
        : commonFunctions;
    } else {
      switch (valueType.cellValueType.toString()) {
        case 'number':
          values = ['sum', 'average', 'min', 'max', ...commonFunctions];
          break;
        case 'dateTime':
          values = [
            ...commonFunctions,
            'earliestDate',
            'latestDate',
            'dateRangeOfDays',
            'dateRangeOfMonths',
          ];
          break;
        case 'boolean':
          values = ['count', 'checked', 'unChecked', 'percentChecked', 'percentUnChecked'];
          break;
        default:
          values = commonFunctions;
      }
    }

    if (fieldType === 'attachment') {
      values = [
        ...values.filter((value) => !['unique', 'percentUnique'].includes(value)),
        'totalAttachmentSize',
      ];
    }

    return ok(new Set(values));
  });
};

const resolveField = (table: Table, fieldId: string): Result<Field, DomainError> =>
  table
    .getField((field) => field.id().toString() === fieldId)
    .mapErr(() =>
      domainError.validation({
        code: 'record_aggregation.field_not_found',
        message: `Aggregation field not found: ${fieldId}`,
        details: { fieldId },
      })
    );

const assertVisible = (
  visibleFieldIds: ReadonlySet<string> | undefined,
  fieldId: string
): Result<void, DomainError> => {
  if (!visibleFieldIds || visibleFieldIds.has(fieldId)) return ok(undefined);
  return err(
    domainError.forbidden({
      code: 'record_aggregation.field_hidden',
      message: 'field is hidden, not allowed',
      details: { fieldId },
    })
  );
};

export function createRecordAggregation(
  this: Table,
  params: CreateRecordAggregationParams
): Result<TableRecordAggregation, DomainError> {
  return safeTry<TableRecordAggregation, DomainError>(
    function* (this: Table) {
      const view = params.viewId ? yield* this.getViewById(params.viewId) : undefined;
      const visibleFieldIds =
        params.includeHiddenFields || !params.viewId
          ? undefined
          : new Set((yield* this.getOrderedVisibleFieldIds(params.viewId)).map(String));
      const requestedFields =
        params.fields ??
        (view
          ? Object.entries((yield* view.columnMeta()).toDto())
              .filter(
                ([fieldId, meta]) =>
                  typeof meta.statisticFunc === 'string' &&
                  meta.statisticFunc &&
                  (!visibleFieldIds || visibleFieldIds.has(fieldId))
              )
              .map(([fieldId, meta]) => ({
                fieldId,
                statisticFunc: meta.statisticFunc!,
              }))
          : []);

      const fields: TableRecordAggregationField[] = [];
      for (const input of requestedFields) {
        const field = yield* resolveField(this, input.fieldId);
        yield* assertVisible(visibleFieldIds, input.fieldId);
        if (
          !tableRecordAggregationFunctionValues.includes(
            input.statisticFunc as TableRecordAggregationFunction
          )
        ) {
          return err(
            domainError.validation({
              code: 'record_aggregation.function_invalid',
              message: `Unknown aggregation function: ${input.statisticFunc}`,
              details: { fieldId: input.fieldId, statisticFunc: input.statisticFunc },
            })
          );
        }
        const statisticFunc = input.statisticFunc as TableRecordAggregationFunction;
        const validFunctions = yield* validFunctionsForField(field);
        if (!validFunctions.has(statisticFunc)) {
          return err(
            domainError.validation({
              code: 'record_aggregation.function_not_supported',
              message: `Aggregation function '${statisticFunc}' is not supported by field '${input.fieldId}'`,
              details: {
                fieldId: input.fieldId,
                statisticFunc,
                validFunctions: [...validFunctions],
              },
            })
          );
        }
        fields.push({ fieldId: field.id(), statisticFunc });
      }

      const groupBy: TableRecordAggregationGroup[] = [];
      for (const group of params.groupBy?.slice(0, 3) ?? []) {
        const field = yield* resolveField(this, group.fieldId);
        yield* assertVisible(visibleFieldIds, group.fieldId);
        groupBy.push({
          fieldId: field.id(),
          fieldType: field.type().toString(),
          order: group.order,
        });
      }

      return ok(TableRecordAggregation.create(fields, groupBy));
    }.bind(this)
  );
}
