import { ok, safeTry } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { flattenAndSpecs } from '../../domain/shared/specification/composeAndSpecs';
import { UpdateLinkConfigSpec } from '../../domain/table/specs/field-updates/UpdateLinkConfigSpec';
import type { Table } from '../../domain/table/Table';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { FieldOperationKind, FieldOperationTargetKind } from '../../ports/FieldOperationPlugin';
import type { FieldOperationPluginRunner } from './FieldOperationPluginRunner';

export const guardViewLinkFilterChanges = async (
  runner: FieldOperationPluginRunner,
  executionContext: IExecutionContext,
  sourceTable: Table,
  table: Table,
  update: TableUpdateResult,
  sourceOperation: 'deleteView' | 'restoreView'
) => safeTry<void, DomainError>(async function* () {
  const previousFields = new Map(table.getFields().map((field) => [field.id().toString(), field]));
  for (const spec of flattenAndSpecs(update.mutateSpec)) {
    if (!(spec instanceof UpdateLinkConfigSpec)) continue;
    const execution = yield* await runner.prepare({
      kind: FieldOperationKind.update,
      executionContext,
      table,
      target: { kind: FieldOperationTargetKind.sideEffect, sourceTable, sourceOperation },
      payload: {
        fieldId: spec.fieldId(),
        previousField: previousFields.get(spec.fieldId().toString())!,
        fieldUpdate: { options: yield* spec.nextConfig().toDto() },
        updateSpecs: [spec],
        foreignTables: [sourceTable],
        allowNoop: false,
      },
      isTransactionBound: true,
    });
    yield* await execution.guard();
  }
  return ok(undefined);
});
