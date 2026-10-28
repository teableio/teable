import { Injectable } from '@nestjs/common';
import {
  err,
  ok,
  RecordWriteOperationKind,
  type DomainError,
  type IRecordWritePlugin,
  type RecordWritePluginContext,
  type Result,
} from '@teable/v2-core';
import { CustomHttpException } from '../../custom.exception';
import { toCrossBaseLinkDomainError } from './cross-base-link-access.plugin-support';
import type { CrossBaseLinkAccessService } from './cross-base-link-access.service';

export const CROSS_BASE_LINK_ACCESS_RECORD_WRITE_PLUGIN_NAME = 'crossBaseLinkAccessRecordWrite';

/**
 * Every operation whose payload carries caller-provided cell values is checked.
 * Only the operations that cannot introduce a link cell are skipped:
 * - buttonClick persists a derived click count;
 * - deleteMany / archiveMany carry no field values.
 * Duplicate and duplicateStream are checked too: they still write the copied
 * link cell into the foreign table, and denying keeps every v2 write on one
 * rule instead of a per-handler list.
 */
const UNCHECKED_OPERATIONS: ReadonlySet<RecordWriteOperationKind> = new Set([
  RecordWriteOperationKind.buttonClick,
  RecordWriteOperationKind.deleteMany,
  RecordWriteOperationKind.archiveMany,
]);

type IPreparedState = {
  readonly checkedFieldKeys: ReadonlySet<string>;
};

const addFieldValues = (
  target: Set<string>,
  fieldValues: ReadonlyMap<string, unknown> | undefined
): void => {
  fieldValues?.forEach((_value, key) => target.add(key));
};

/**
 * The keys a v2 payload carries once `FieldKeyResolverService` has run, i.e.
 * field ids. `CrossBaseLinkAccessService` matches ids, names and db field names,
 * so a payload that still carries a name stays covered.
 */
const collectFieldKeys = (context: RecordWritePluginContext): Set<string> => {
  const keys = new Set<string>();

  switch (context.kind) {
    case RecordWriteOperationKind.createOne:
    case RecordWriteOperationKind.submit:
    case RecordWriteOperationKind.updateOne:
    case RecordWriteOperationKind.duplicate:
      addFieldValues(keys, context.payload.fieldValues);
      break;
    case RecordWriteOperationKind.createMany:
    case RecordWriteOperationKind.createStream:
    case RecordWriteOperationKind.importAppend:
    case RecordWriteOperationKind.upsertRecords:
    case RecordWriteOperationKind.restoreMany:
    case RecordWriteOperationKind.duplicateStream:
      context.payload.recordsFieldValues.forEach((fieldValues) =>
        addFieldValues(keys, fieldValues)
      );
      break;
    case RecordWriteOperationKind.updateMany:
      if (context.payload.variant === 'selector') {
        addFieldValues(keys, context.payload.fieldValues);
      } else {
        context.payload.recordUpdates.forEach((update) => addFieldValues(keys, update.fieldValues));
      }
      break;
    case RecordWriteOperationKind.paste:
      // The operation-scope payload of a streamed paste only lists the editable
      // columns; later chunks carry the same columns plus record values.
      context.payload.editableFieldIds.forEach((fieldId) => keys.add(fieldId.toString()));
      context.payload.updateRecordsFieldValues.forEach((fieldValues) =>
        addFieldValues(keys, fieldValues)
      );
      context.payload.createRecordsFieldValues.forEach((fieldValues) =>
        addFieldValues(keys, fieldValues)
      );
      break;
    default:
      break;
  }

  return keys;
};

/**
 * Enforces the cross-base link read rule for every v2 record write.
 *
 * The check itself stays in `CrossBaseLinkAccessService`: the v1 write paths do
 * not run through a v2 command and call it directly, so this plugin delegates
 * instead of reimplementing. Splitting it out of the Nest entry points means a
 * new v2 route, or a shared command handler reached from another service, gets
 * the check without anyone remembering to add a call.
 */
@Injectable()
export class CrossBaseLinkAccessRecordWritePlugin implements IRecordWritePlugin<IPreparedState> {
  readonly name = CROSS_BASE_LINK_ACCESS_RECORD_WRITE_PLUGIN_NAME;
  readonly enforce = 'pre' as const;

  constructor(private readonly crossBaseLinkAccess: CrossBaseLinkAccessService) {}

  supports(operation: RecordWriteOperationKind): boolean {
    return !UNCHECKED_OPERATIONS.has(operation);
  }

  async prepare(
    context: RecordWritePluginContext,
    previousPreparedState?: IPreparedState
  ): Promise<Result<IPreparedState, DomainError>> {
    const fieldKeys = collectFieldKeys(context);
    const checkedFieldKeys = previousPreparedState?.checkedFieldKeys;

    // Streamed operations re-prepare per chunk with the same columns; the
    // earlier check still holds when the new keys are a subset of it.
    if (
      fieldKeys.size === 0 ||
      (checkedFieldKeys && [...fieldKeys].every((key) => checkedFieldKeys.has(key)))
    ) {
      return ok(previousPreparedState ?? { checkedFieldKeys: new Set() });
    }

    const tableId = context.table.id().toString();
    try {
      await this.crossBaseLinkAccess.assertForeignTablesReadable(tableId, fieldKeys);
    } catch (error) {
      if (!(error instanceof CustomHttpException)) {
        throw error;
      }

      return err(toCrossBaseLinkDomainError(error, { operation: context.kind, tableId }));
    }

    return ok({
      checkedFieldKeys: new Set([...(checkedFieldKeys ?? []), ...fieldKeys]),
    });
  }
}
