import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import {
  composeAndSpecsOrUndefined,
  flattenAndSpecs,
} from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import {
  buildFieldFilterSyncPlan,
  hasFieldSelectOptionChanges,
  hasFieldFilterSyncPlanChanges,
} from '../../domain/table/fields/filter-sync';
import {
  implementsOnTeableFieldUpdated,
  type FieldUpdateContext,
} from '../../domain/table/fields/OnTeableFieldUpdated';
import { ConditionalLookupField } from '../../domain/table/fields/types/ConditionalLookupField';
import { ConditionalRollupField } from '../../domain/table/fields/types/ConditionalRollupField';
import { FormulaField } from '../../domain/table/fields/types/FormulaField';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import { LookupField } from '../../domain/table/fields/types/LookupField';
import { RollupField } from '../../domain/table/fields/types/RollupField';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../../domain/table/specs/TableUpdateFieldTypeSpec';
import { Table } from '../../domain/table/Table';
import { TableUpdateResult } from '../../domain/table/TableMutator';
import * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { TraceSpan } from '../../ports/TraceSpan';
import { TableUpdateFlow } from './TableUpdateFlow';

type FieldCrossTableUpdateSideEffectInput = {
  table: Table;
  updatedField: Field;
  updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
};

type CrossTableFieldUpdate = {
  table: Table;
  updatedField: Field;
  updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
};

@injectable()
export class FieldCrossTableUpdateSideEffectService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  @TraceSpan()
  async execute(
    context: ExecutionContextPort.IExecutionContext,
    input: FieldCrossTableUpdateSideEffectInput
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const service = this;
    return safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
      const events: IDomainEvent[] = [];
      const pendingUpdates: CrossTableFieldUpdate[] = [input];
      const processedUpdates = new Set<string>();

      while (pendingUpdates.length > 0) {
        const pending = pendingUpdates.shift();
        if (!pending) {
          continue;
        }

        const pendingKey = service.buildPendingUpdateKey(pending);
        if (processedUpdates.has(pendingKey)) {
          continue;
        }
        processedUpdates.add(pendingKey);

        const filterSyncPlan = buildFieldFilterSyncPlan(pending.updatedField, pending.updateSpecs);
        const hasSelectOptionChanges = hasFieldSelectOptionChanges(
          pending.updatedField,
          pending.updateSpecs
        );
        if (
          !service.hasTypeConversion(pending.updateSpecs) &&
          !hasFieldFilterSyncPlanChanges(filterSyncPlan) &&
          !hasSelectOptionChanges
        ) {
          continue;
        }

        const specResult = Table.specs(pending.table.baseId()).build();
        if (specResult.isErr()) return err(specResult.error);

        const candidateTables = yield* await service.tableRepository.find(
          context,
          specResult.value
        );
        if (candidateTables.length === 0) {
          continue;
        }

        for (const candidateTable of candidateTables) {
          const cleanupSpecResult = service.buildCleanupSpecs(
            candidateTable,
            pending.table,
            pending.updatedField,
            pending.updateSpecs
          );
          if (cleanupSpecResult.isErr()) return err(cleanupSpecResult.error);
          const cleanupSpec = cleanupSpecResult.value;
          if (!cleanupSpec) continue;

          const flattenedSpecs = flattenAndSpecs(cleanupSpec);
          const updateResult = yield* await service.tableUpdateFlow.execute(
            context,
            { table: candidateTable },
            (table) => {
              const updatedTable = cleanupSpec.mutate(table);
              if (updatedTable.isErr()) return err(updatedTable.error);
              return ok(TableUpdateResult.create(updatedTable.value, cleanupSpec));
            },
            { publishEvents: false }
          );
          events.push(...updateResult.events);
          pendingUpdates.push(
            ...service.collectFollowUpUpdates(updateResult.table, flattenedSpecs)
          );
        }
      }

      return ok(events);
    });
  }

  private hasTypeConversion(
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): boolean {
    return updateSpecs.some(
      (spec) => spec instanceof TableUpdateFieldTypeSpec && spec.isTypeConversion()
    );
  }

  private buildCleanupSpecs(
    candidateTable: Table,
    updatedTable: Table,
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const directSpecs: Array<ISpecification<Table, ITableSpecVisitor>> = [];
    const updateContext: FieldUpdateContext = {
      table: candidateTable,
      foreignTables: [updatedTable],
    };

    for (const field of candidateTable.getFields()) {
      if (!this.referencesUpdatedTable(field, updatedTable)) continue;
      if (!implementsOnTeableFieldUpdated(field)) continue;

      const result = field.onDependencyUpdated(updatedField, updateSpecs, updateContext);
      if (result.isErr()) return err(result.error);
      directSpecs.push(...flattenAndSpecs(result.value));
    }

    if (directSpecs.length === 0) {
      return ok(undefined);
    }

    const allSpecs: Array<ISpecification<Table, ITableSpecVisitor>> = [...directSpecs];
    let workingTable = candidateTable;

    const changedFieldQueue: Field[] = [];
    for (const spec of directSpecs) {
      const mutateResult = spec.mutate(workingTable);
      if (mutateResult.isErr()) return err(mutateResult.error);
      workingTable = mutateResult.value;
      if (spec instanceof TableUpdateFieldTypeSpec) {
        changedFieldQueue.push(spec.newField());
      }
    }

    const processedPairs = new Set<string>();
    for (let i = 0; i < changedFieldQueue.length; i++) {
      const triggerField = changedFieldQueue[i]!;
      const fields = workingTable.getFields();

      for (const field of fields) {
        if (!implementsOnTeableFieldUpdated(field)) continue;
        if (field.id().equals(triggerField.id())) continue;
        if (!this.isFieldDependentOn(field, triggerField.id())) continue;

        const pairKey = `${field.id().toString()}::${triggerField.id().toString()}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const cascadeResult = field.onDependencyUpdated(
          triggerField,
          [...updateSpecs, ...allSpecs],
          {
            table: workingTable,
            foreignTables: [updatedTable],
          }
        );
        if (cascadeResult.isErr()) return err(cascadeResult.error);
        const cascadeSpecs = flattenAndSpecs(cascadeResult.value);
        if (cascadeSpecs.length === 0) continue;

        for (const spec of cascadeSpecs) {
          const mutateResult = spec.mutate(workingTable);
          if (mutateResult.isErr()) return err(mutateResult.error);
          workingTable = mutateResult.value;
          allSpecs.push(spec);

          if (spec instanceof TableUpdateFieldTypeSpec) {
            changedFieldQueue.push(spec.newField());
          }
        }
      }
    }

    return ok(composeAndSpecsOrUndefined(allSpecs));
  }

  private collectFollowUpUpdates(
    table: Table,
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): ReadonlyArray<CrossTableFieldUpdate> {
    const updates: CrossTableFieldUpdate[] = [];

    for (const spec of specs) {
      if (!(spec instanceof TableUpdateFieldTypeSpec)) {
        continue;
      }

      const updatedFieldResult = table.getField((field) => field.id().equals(spec.newField().id()));
      if (updatedFieldResult.isErr()) {
        continue;
      }

      updates.push({
        table,
        updatedField: updatedFieldResult.value,
        updateSpecs: [spec],
      });
    }

    return updates;
  }

  private buildPendingUpdateKey(update: CrossTableFieldUpdate): string {
    return [
      update.table.id().toString(),
      update.updatedField.id().toString(),
      ...update.updateSpecs.map((spec) => this.buildSpecKey(spec)),
    ].join('::');
  }

  private buildSpecKey(spec: ISpecification<Table, ITableSpecVisitor>): string {
    if (spec instanceof TableUpdateFieldTypeSpec) {
      return [
        'TableUpdateFieldTypeSpec',
        spec.oldField().id().toString(),
        spec.oldField().type().toString(),
        spec.newField().type().toString(),
        spec.isTypeConversion() ? 'conversion' : 'shape',
      ].join(':');
    }

    return spec.constructor.name;
  }

  private isFieldDependentOn(field: Field, dependencyFieldId: FieldId): boolean {
    if (field.dependencies().some((depId) => depId.equals(dependencyFieldId))) {
      return true;
    }

    if (field instanceof FormulaField) {
      const referencedFieldIds = field.expression().getReferencedFieldIds();
      if (referencedFieldIds.isOk()) {
        if (referencedFieldIds.value.some((depId) => depId.equals(dependencyFieldId))) {
          return true;
        }
      }
    }

    return false;
  }

  private referencesUpdatedTable(field: Field, updatedTable: Table): boolean {
    if (
      field instanceof LinkField ||
      field instanceof LookupField ||
      field instanceof RollupField ||
      field instanceof ConditionalLookupField ||
      field instanceof ConditionalRollupField
    ) {
      return field.foreignTableId().equals(updatedTable.id());
    }
    return false;
  }
}
