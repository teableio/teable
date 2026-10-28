import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../domain/shared/DomainContext';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import { FieldCreationSideEffectVisitor } from '../../domain/table/fields/visitors/FieldCreationSideEffectVisitor';
import { FieldDeletionSideEffectVisitor } from '../../domain/table/fields/visitors/FieldDeletionSideEffectVisitor';
import { LinkFieldUpdateSideEffectVisitor } from '../../domain/table/fields/visitors/LinkFieldUpdateSideEffectVisitor';
import { RemoveSymmetricLinkFieldSpec } from '../../domain/table/specs/field-updates/RemoveSymmetricLinkFieldSpec';
import { UpdateLinkConfigSpec } from '../../domain/table/specs/field-updates/UpdateLinkConfigSpec';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableAddFieldSpec } from '../../domain/table/specs/TableAddFieldSpec';
import { TableRemoveFieldSpec } from '../../domain/table/specs/TableRemoveFieldSpec';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { FieldOperationKind, FieldOperationTargetKind } from '../../ports/FieldOperationPlugin';
import type { FieldOperationPluginContext } from '../../ports/FieldOperationPlugin';
import type {
  FieldOperationPluginExecution,
  FieldOperationPluginRunner,
} from './FieldOperationPluginRunner';

export type FieldOperationSideEffect = {
  readonly foreignTable: Table;
  readonly mutateSpec: ISpecification<Table, ITableSpecVisitor>;
};

type PreparedSideEffectExecution = {
  readonly context: FieldOperationPluginContext;
  readonly lifecycleContext: FieldOperationPluginContext;
  readonly execution: FieldOperationPluginExecution;
};

export class FieldOperationSideEffectPluginExecutionSet {
  constructor(private readonly entries: ReadonlyArray<PreparedSideEffectExecution>) {}

  async guard(): Promise<Result<void, DomainError>> {
    for (const entry of this.entries) {
      const result = await entry.execution.guard();
      if (result.isErr()) return err(result.error);
    }
    return ok(undefined);
  }

  async beforePersist(executionContext: IExecutionContext): Promise<Result<void, DomainError>> {
    for (const entry of this.entries) {
      const result = await entry.execution.beforePersist(executionContext, {
        ...entry.lifecycleContext,
        executionContext,
        isTransactionBound: true,
      });
      if (result.isErr()) return err(result.error);
    }
    return ok(undefined);
  }

  async afterCommit(): Promise<void> {
    for (const entry of this.entries) {
      await entry.execution.afterCommit(entry.lifecycleContext);
    }
  }
}

export type PrepareFieldOperationSideEffectPluginsInput = {
  readonly runner: FieldOperationPluginRunner;
  readonly executionContext: IExecutionContext;
  readonly sourceOperation: FieldOperationKind;
  readonly sourceTable: Table;
  readonly foreignTables: ReadonlyArray<Table>;
  readonly domainContext?: IDomainContext;
  readonly sideEffects: ReadonlyArray<FieldOperationSideEffect>;
};

const buildContexts = (
  input: PrepareFieldOperationSideEffectPluginsInput,
  table: Table,
  sideEffect: FieldOperationSideEffect
): Result<
  {
    context: FieldOperationPluginContext;
    lifecycleContext: FieldOperationPluginContext;
    updatedTable: Table;
  },
  DomainError
> => {
  const target = {
    kind: FieldOperationTargetKind.sideEffect,
    sourceOperation: input.sourceOperation,
    sourceTable: input.sourceTable,
  } as const;
  const updatedTableResult = sideEffect.mutateSpec.mutate(table);
  if (updatedTableResult.isErr()) return err(updatedTableResult.error);
  const updatedTable = updatedTableResult.value;

  if (sideEffect.mutateSpec instanceof TableAddFieldSpec) {
    const createdField = sideEffect.mutateSpec.field();
    const context: FieldOperationPluginContext = {
      kind: FieldOperationKind.create,
      executionContext: input.executionContext,
      table,
      target,
      payload: {
        candidateField: createdField,
        foreignTables: input.foreignTables,
        domainContext: input.domainContext,
      },
      isTransactionBound: false,
    };
    return ok({
      context,
      lifecycleContext: {
        ...context,
        table: updatedTable,
        result: { createdField },
      },
      updatedTable,
    });
  }

  if (
    sideEffect.mutateSpec instanceof TableRemoveFieldSpec ||
    sideEffect.mutateSpec instanceof RemoveSymmetricLinkFieldSpec
  ) {
    const deletedField = sideEffect.mutateSpec.field();
    const context: FieldOperationPluginContext = {
      kind: FieldOperationKind.delete,
      executionContext: input.executionContext,
      table,
      target,
      payload: {
        fieldId: deletedField.id(),
        targetField: deletedField,
        foreignTables: input.foreignTables,
        skipUndoRedo: true,
      },
      isTransactionBound: false,
    };
    return ok({
      context,
      lifecycleContext: {
        ...context,
        table: updatedTable,
        result: { deletedField },
      },
      updatedTable,
    });
  }

  if (sideEffect.mutateSpec instanceof UpdateLinkConfigSpec) {
    const updateSpec = sideEffect.mutateSpec;
    const previousFieldResult = table.getField((field) => field.id().equals(updateSpec.fieldId()));
    if (previousFieldResult.isErr()) return err(previousFieldResult.error);
    const updatedFieldResult = updatedTable.getField((field) =>
      field.id().equals(updateSpec.fieldId())
    );
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
    const nextConfigResult = updateSpec.nextConfig().toDto();
    if (nextConfigResult.isErr()) return err(nextConfigResult.error);

    const context: FieldOperationPluginContext = {
      kind: FieldOperationKind.update,
      executionContext: input.executionContext,
      table,
      target,
      payload: {
        fieldId: updateSpec.fieldId(),
        fieldUpdate: { options: nextConfigResult.value },
        previousField: previousFieldResult.value,
        updateSpecs: [updateSpec],
        foreignTables: input.foreignTables,
        allowNoop: false,
      },
      isTransactionBound: false,
    };
    return ok({
      context,
      lifecycleContext: {
        ...context,
        table: updatedTable,
        result: { updatedField: updatedFieldResult.value },
      },
      updatedTable,
    });
  }

  return err(
    domainError.invariant({
      message: 'Unsupported field operation side-effect specification',
    })
  );
};

export const prepareFieldOperationSideEffectPlugins = async (
  input: PrepareFieldOperationSideEffectPluginsInput
): Promise<Result<FieldOperationSideEffectPluginExecutionSet, DomainError>> => {
  const entries: PreparedSideEffectExecution[] = [];
  const tableState = new Map<string, Table>(
    input.foreignTables.map((table) => [table.id().toString(), table])
  );
  tableState.set(input.sourceTable.id().toString(), input.sourceTable);

  for (const sideEffect of input.sideEffects) {
    const tableId = sideEffect.foreignTable.id().toString();
    const table = tableState.get(tableId) ?? sideEffect.foreignTable;
    const contextsResult = buildContexts(input, table, sideEffect);
    if (contextsResult.isErr()) return err(contextsResult.error);

    const executionResult = await input.runner.prepare(contextsResult.value.context);
    if (executionResult.isErr()) return err(executionResult.error);

    entries.push({
      context: contextsResult.value.context,
      lifecycleContext: contextsResult.value.lifecycleContext,
      execution: executionResult.value,
    });
    tableState.set(tableId, contextsResult.value.updatedTable);
  }

  return ok(new FieldOperationSideEffectPluginExecutionSet(entries));
};

export const collectFieldCreationSideEffects = (
  table: Table,
  fields: ReadonlyArray<Field>,
  foreignTables: ReadonlyArray<Table>,
  domainContext?: IDomainContext
): Result<ReadonlyArray<FieldOperationSideEffect>, DomainError> =>
  FieldCreationSideEffectVisitor.collect(fields, {
    table,
    foreignTables,
    domainContext,
  });

export const collectFieldDeletionSideEffects = (
  table: Table,
  fields: ReadonlyArray<Field>,
  foreignTables: ReadonlyArray<Table>
): Result<ReadonlyArray<FieldOperationSideEffect>, DomainError> =>
  FieldDeletionSideEffectVisitor.collect(fields, { table, foreignTables });

export const collectFieldUpdateSideEffects = (
  table: Table,
  updatedField: Field,
  previousField: Field | undefined,
  foreignTables: ReadonlyArray<Table>,
  domainContext?: IDomainContext
): Result<ReadonlyArray<FieldOperationSideEffect>, DomainError> => {
  if (!(updatedField instanceof LinkField)) {
    return previousField instanceof LinkField
      ? collectFieldDeletionSideEffects(table, [previousField], foreignTables)
      : ok([]);
  }

  if (previousField instanceof LinkField) {
    if (
      !LinkFieldUpdateSideEffectVisitor.requiresSymmetricFieldChange(
        previousField.config(),
        updatedField.config()
      )
    ) {
      return ok([]);
    }

    return LinkFieldUpdateSideEffectVisitor.create({ table, foreignTables }).collect({
      currentField: updatedField,
      previousConfig: previousField.config(),
      nextConfig: updatedField.config(),
    });
  }

  if (updatedField.isOneWay()) return ok([]);
  return collectFieldCreationSideEffects(table, [updatedField], foreignTables, domainContext);
};
