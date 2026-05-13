import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import {
  ensureWithinTableDataSafetyLimit,
  measureJsonBytes,
  resolveTableDataSafetyLimits,
} from '../../domain/shared/TableDataSafetyLimits';
import {
  RecordWriteOperationKind,
  type IRecordWritePlugin,
  type RecordWriteFieldValues,
  type RecordWritePluginContext,
} from '../../ports/RecordWritePlugin';
import {
  createDefaultTableDataSafetyLimitComposer,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';

type PreparedTableDataSafetyRecordLimitState = {
  readonly limits: ReturnType<typeof resolveTableDataSafetyLimits>;
};

const recordsFromContext = (
  context: RecordWritePluginContext
): ReadonlyArray<RecordWriteFieldValues> => {
  switch (context.kind) {
    case RecordWriteOperationKind.createOne:
    case RecordWriteOperationKind.submit:
    case RecordWriteOperationKind.duplicate:
    case RecordWriteOperationKind.updateOne:
      return [context.payload.fieldValues];
    case RecordWriteOperationKind.createMany:
    case RecordWriteOperationKind.createStream:
    case RecordWriteOperationKind.duplicateStream:
    case RecordWriteOperationKind.importAppend:
      return context.payload.recordsFieldValues;
    case RecordWriteOperationKind.updateMany:
      return context.payload.variant === 'explicit'
        ? context.payload.recordUpdates.map((record) => record.fieldValues)
        : [context.payload.fieldValues];
    case RecordWriteOperationKind.paste:
      return [
        ...context.payload.updateRecordsFieldValues,
        ...context.payload.createRecordsFieldValues,
      ];
    case RecordWriteOperationKind.deleteMany:
      return [];
  }
};

const recordCountFromContext = (context: RecordWritePluginContext): number => {
  switch (context.kind) {
    case RecordWriteOperationKind.createOne:
    case RecordWriteOperationKind.submit:
    case RecordWriteOperationKind.duplicate:
    case RecordWriteOperationKind.updateOne:
      return 1;
    case RecordWriteOperationKind.createMany:
    case RecordWriteOperationKind.createStream:
    case RecordWriteOperationKind.duplicateStream:
    case RecordWriteOperationKind.importAppend:
    case RecordWriteOperationKind.deleteMany:
      return context.payload.recordCount;
    case RecordWriteOperationKind.updateMany:
      return context.payload.recordCount ?? recordsFromContext(context).length;
    case RecordWriteOperationKind.paste:
      return context.payload.recordCount;
  }
};

export class TableDataSafetyLimitRecordWritePlugin
  implements IRecordWritePlugin<PreparedTableDataSafetyRecordLimitState>
{
  readonly name = 'table-data-safety-record-limit';
  readonly enforce = 'post' as const;

  constructor(
    private readonly limitComposer: TableDataSafetyLimitComposer = createDefaultTableDataSafetyLimitComposer()
  ) {}

  supports(operation: RecordWriteOperationKind): boolean {
    return operation !== RecordWriteOperationKind.deleteMany;
  }

  async prepare(
    context: RecordWritePluginContext
  ): Promise<Result<PreparedTableDataSafetyRecordLimitState, DomainError>> {
    const configResult = await this.limitComposer.compose(context.executionContext);
    if (configResult.isErr()) return err(configResult.error);
    return ok({ limits: resolveTableDataSafetyLimits(configResult.value) });
  }

  guard(
    context: RecordWritePluginContext,
    preparedState: PreparedTableDataSafetyRecordLimitState | undefined
  ): Result<void, DomainError> {
    const limits = preparedState?.limits ?? resolveTableDataSafetyLimits();
    const recordCountResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.records_per_mutation_max',
      recordCountFromContext(context),
      limits.recordValues.maxRecordsPerMutation,
      {
        operation: context.kind,
        tableId: context.table.id().toString(),
      }
    );
    if (recordCountResult.isErr()) return recordCountResult;

    const records = recordsFromContext(context);
    for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
      const record = records[recordIndex]!;
      const recordBytesResult = ensureWithinTableDataSafetyLimit(
        'validation.limit.record_fields_max_bytes',
        measureJsonBytes(Object.fromEntries(record)),
        limits.recordValues.maxRecordFieldsBytes,
        {
          operation: context.kind,
          tableId: context.table.id().toString(),
          recordIndex,
        }
      );
      if (recordBytesResult.isErr()) return recordBytesResult;

      for (const [fieldId, value] of record.entries()) {
        const cellBytesResult = ensureWithinTableDataSafetyLimit(
          'validation.limit.cell_value_max_bytes',
          measureJsonBytes(value),
          limits.recordValues.maxCellValueBytes,
          {
            operation: context.kind,
            tableId: context.table.id().toString(),
            recordIndex,
            fieldId,
          }
        );
        if (cellBytesResult.isErr()) return cellBytesResult;
      }
    }

    return ok(undefined);
  }
}
