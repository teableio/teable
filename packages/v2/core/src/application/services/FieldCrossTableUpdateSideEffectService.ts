import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import {
  buildFieldFilterSyncPlan,
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
import { UpdateMultipleSelectOptionsSpec } from '../../domain/table/specs/field-updates/UpdateMultipleSelectOptionsSpec';
import { UpdateSingleSelectOptionsSpec } from '../../domain/table/specs/field-updates/UpdateSingleSelectOptionsSpec';
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
      const filterSyncPlan = buildFieldFilterSyncPlan(input.updatedField, input.updateSpecs);
      const hasLookupTargetSelectOptionChanges = service.hasLookupTargetSelectOptionChanges(
        input.updatedField,
        input.updateSpecs
      );
      if (
        !service.hasTypeConversion(input.updateSpecs) &&
        !hasFieldFilterSyncPlanChanges(filterSyncPlan) &&
        !hasLookupTargetSelectOptionChanges
      ) {
        return ok([]);
      }

      const specResult = Table.specs(input.table.baseId()).build();
      if (specResult.isErr()) return err(specResult.error);

      const tablesResult = yield* await service.tableRepository.find(context, specResult.value);
      const candidateTables = tablesResult;
      if (candidateTables.length === 0) {
        return ok([]);
      }

      const events: IDomainEvent[] = [];

      for (const candidateTable of candidateTables) {
        const cleanupSpecsResult = service.buildCleanupSpecs(
          candidateTable,
          input.table,
          input.updatedField,
          input.updateSpecs
        );
        if (cleanupSpecsResult.isErr()) return err(cleanupSpecsResult.error);
        const cleanupSpecs = cleanupSpecsResult.value;
        if (cleanupSpecs.length === 0) continue;

        const composedSpec = service.composeSpecs(cleanupSpecs);
        const updateResult = yield* await service.tableUpdateFlow.execute(
          context,
          { table: candidateTable },
          (table) => {
            let updatedTable = table;
            for (const spec of cleanupSpecs) {
              const mutateResult = spec.mutate(updatedTable);
              if (mutateResult.isErr()) return err(mutateResult.error);
              updatedTable = mutateResult.value;
            }
            return ok(TableUpdateResult.create(updatedTable, composedSpec));
          },
          { publishEvents: false }
        );
        events.push(...updateResult.events);
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

  private hasLookupTargetSelectOptionChanges(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): boolean {
    return updateSpecs.some((spec) => {
      if (
        spec instanceof UpdateSingleSelectOptionsSpec ||
        spec instanceof UpdateMultipleSelectOptionsSpec
      ) {
        if (!spec.fieldId().equals(updatedField.id())) {
          return false;
        }

        return (
          spec.addedOptions().length > 0 ||
          spec.removedOptions().length > 0 ||
          spec.modifiedOptions().length > 0
        );
      }

      return false;
    });
  }

  private buildCleanupSpecs(
    candidateTable: Table,
    updatedTable: Table,
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
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
      directSpecs.push(...result.value);
    }

    if (directSpecs.length === 0) {
      return ok([]);
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
        if (cascadeResult.value.length === 0) continue;

        for (const spec of cascadeResult.value) {
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

    return ok(allSpecs);
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

  private composeSpecs(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): ISpecification<Table, ITableSpecVisitor> {
    if (specs.length === 1) {
      return specs[0]!;
    }

    let composed: ISpecification<Table, ITableSpecVisitor> = specs[0]!;
    for (let i = 1; i < specs.length; i++) {
      composed = new AndSpec<Table, ITableSpecVisitor>(composed, specs[i]!);
    }
    return composed;
  }
}
