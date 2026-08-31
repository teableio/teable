import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import {
  ensureWithinTableDataSafetyLimit,
  tableDataSafetyLimitErrors,
  measureJsonBytes,
  resolveTableDataSafetyLimits,
} from '../../domain/shared/TableDataSafetyLimits';
import {
  RecordWriteOperationKind,
  type IRecordWritePlugin,
  type RecordWriteFieldValues,
  type RecordWritePluginContext,
} from '../../ports/RecordWritePlugin';
import type { TableDataSafetyLimitComposer } from './TableDataSafetyLimitComposer';
import { createDefaultTableDataSafetyLimitComposer } from './TableDataSafetyLimitComposer';

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
  if (context.orchestration?.mode === 'stream' && context.orchestration.scope === 'operation') {
    return recordsFromContext(context).length;
  }

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
      tableDataSafetyLimitErrors.recordsPerMutationMax,
      recordCountFromContext(context),
      limits.recordValues.maxRecordsPerMutation,
      {
        operation: context.kind,
        tableId: context.table.id().toString(),
      }
    );
    if (recordCountResult.isErr()) return recordCountResult;

    const records = recordsFromContext(context);
    // Cell isolation mutates the payload maps in place, so it is only safe for
    // operations whose payload maps are the exact objects later persisted.
    // Paste (and any other kind) re-derives persisted values from its own
    // source data, where deleting from the guard's map would be a silent no-op
    // — those kinds keep the fail-closed error instead.
    const canIsolateOversizedCells =
      context.kind === RecordWriteOperationKind.createMany ||
      context.kind === RecordWriteOperationKind.updateOne;

    for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
      const record = records[recordIndex]!;
      const mutableRecord = canIsolateOversizedCells && record instanceof Map ? record : undefined;
      // Single pass: cell checks also accumulate the exact record JSON size
      // ({"key":value,...} — undefined cells drop out of stringify), so the
      // record is not stringified a second time just for its own limit.
      let recordBytes = 2;
      let includedEntries = 0;
      let survivingCells = 0;
      let oversizedCellError: DomainError | undefined;
      for (const [fieldId, value] of record.entries()) {
        const cellBytes = measureJsonBytes(value);
        const cellBytesResult = ensureWithinTableDataSafetyLimit(
          tableDataSafetyLimitErrors.cellValueMaxBytes,
          cellBytes,
          limits.recordValues.maxCellValueBytes,
          {
            operation: context.kind,
            tableId: context.table.id().toString(),
            recordIndex,
            fieldId,
          }
        );
        if (cellBytesResult.isErr()) {
          if (!mutableRecord) return cellBytesResult;
          oversizedCellError = oversizedCellError ?? cellBytesResult.error;
          mutableRecord.delete(fieldId);
          continue;
        }
        survivingCells += 1;
        if (value !== undefined) {
          recordBytes += measureJsonBytes(fieldId) + 1 + cellBytes;
          includedEntries += 1;
        }
      }
      if (includedEntries > 1) {
        recordBytes += includedEntries - 1;
      }

      // A record whose every cell was stripped would be persisted empty,
      // silently discarding the caller's data — fail closed per record instead.
      if (oversizedCellError && survivingCells === 0) {
        return err(oversizedCellError);
      }

      const recordBytesResult = ensureWithinTableDataSafetyLimit(
        tableDataSafetyLimitErrors.recordFieldsMaxBytes,
        recordBytes,
        limits.recordValues.maxRecordFieldsBytes,
        {
          operation: context.kind,
          tableId: context.table.id().toString(),
          recordIndex,
        }
      );
      if (recordBytesResult.isErr()) return recordBytesResult;
    }

    return ok(undefined);
  }
}
