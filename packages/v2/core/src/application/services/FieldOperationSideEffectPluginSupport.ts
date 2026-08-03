import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../domain/shared/DomainContext';
import type { DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import { FieldCreationSideEffectVisitor } from '../../domain/table/fields/visitors/FieldCreationSideEffectVisitor';
import {
  LinkFieldUpdateSideEffectVisitor,
  type LinkFieldUpdateSideEffect,
} from '../../domain/table/fields/visitors/LinkFieldUpdateSideEffectVisitor';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableAddFieldSpec } from '../../domain/table/specs/TableAddFieldSpec';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { FieldOperationKind, FieldOperationTargetKind } from '../../ports/FieldOperationPlugin';
import type { FieldOperationPluginContext } from '../../ports/FieldOperationPlugin';
import type {
  FieldOperationPluginExecution,
  FieldOperationPluginRunner,
} from './FieldOperationPluginRunner';

type FieldAddSideEffect = {
  readonly foreignTable: Table;
  readonly mutateSpec: ISpecification<Table, ITableSpecVisitor>;
};

type PreparedSideEffectExecution = {
  readonly context: FieldOperationPluginContext;
  readonly execution: FieldOperationPluginExecution;
};

export class FieldOperationSideEffectPluginExecutionSet {
  constructor(private readonly entries: ReadonlyArray<PreparedSideEffectExecution>) {}

  async guard(): Promise<Result<void, DomainError>> {
    for (const entry of this.entries) {
      const result = await entry.execution.guard();
      if (result.isErr()) {
        return err(result.error);
      }
    }

    return ok(undefined);
  }

  async beforePersist(executionContext: IExecutionContext): Promise<Result<void, DomainError>> {
    for (const entry of this.entries) {
      const result = await entry.execution.beforePersist(executionContext, {
        ...entry.context,
        executionContext,
        isTransactionBound: true,
      });
      if (result.isErr()) {
        return err(result.error);
      }
    }

    return ok(undefined);
  }

  async afterCommit(): Promise<void> {
    for (const entry of this.entries) {
      await entry.execution.afterCommit();
    }
  }
}

export type PrepareFieldAddSideEffectPluginsInput = {
  readonly runner: FieldOperationPluginRunner;
  readonly executionContext: IExecutionContext;
  readonly sourceOperation: FieldOperationKind;
  readonly sourceTable: Table;
  readonly foreignTables: ReadonlyArray<Table>;
  readonly domainContext?: IDomainContext;
  readonly sideEffects: ReadonlyArray<FieldAddSideEffect>;
};

export const prepareFieldAddSideEffectPlugins = async (
  input: PrepareFieldAddSideEffectPluginsInput
): Promise<Result<FieldOperationSideEffectPluginExecutionSet, DomainError>> => {
  const entries: PreparedSideEffectExecution[] = [];

  for (const sideEffect of input.sideEffects) {
    if (!(sideEffect.mutateSpec instanceof TableAddFieldSpec)) {
      continue;
    }

    const pluginContext: FieldOperationPluginContext = {
      kind: FieldOperationKind.create,
      executionContext: input.executionContext,
      table: sideEffect.foreignTable,
      target: {
        kind: FieldOperationTargetKind.sideEffect,
        sourceOperation: input.sourceOperation,
        sourceTable: input.sourceTable,
      },
      payload: {
        candidateField: sideEffect.mutateSpec.field(),
        foreignTables: input.foreignTables,
        domainContext: input.domainContext,
      },
      isTransactionBound: false,
    };

    const executionResult = await input.runner.prepare(pluginContext);
    if (executionResult.isErr()) {
      return err(executionResult.error);
    }

    entries.push({
      context: pluginContext,
      execution: executionResult.value,
    });
  }

  return ok(new FieldOperationSideEffectPluginExecutionSet(entries));
};

export const collectFieldCreationAddSideEffects = (
  table: Table,
  fields: ReadonlyArray<Field>,
  foreignTables: ReadonlyArray<Table>,
  domainContext?: IDomainContext
): Result<ReadonlyArray<FieldAddSideEffect>, DomainError> => {
  return FieldCreationSideEffectVisitor.collect(fields, {
    table,
    foreignTables,
    domainContext,
  });
};

export const collectFieldUpdateAddSideEffects = (
  table: Table,
  updatedField: Field,
  previousField: Field | undefined,
  foreignTables: ReadonlyArray<Table>,
  domainContext?: IDomainContext
): Result<ReadonlyArray<FieldAddSideEffect>, DomainError> => {
  if (!(updatedField instanceof LinkField)) {
    return ok([]);
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

    const visitor = LinkFieldUpdateSideEffectVisitor.create({
      table,
      foreignTables,
    });
    return visitor.collect({
      currentField: updatedField,
      previousConfig: previousField.config(),
      nextConfig: updatedField.config(),
    }) as Result<ReadonlyArray<LinkFieldUpdateSideEffect>, DomainError>;
  }

  if (updatedField.isOneWay()) {
    return ok([]);
  }

  return collectFieldCreationAddSideEffects(table, [updatedField], foreignTables, domainContext);
};
