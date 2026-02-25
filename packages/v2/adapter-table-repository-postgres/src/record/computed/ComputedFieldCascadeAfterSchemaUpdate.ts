import type {
  DomainError,
  Field,
  FieldId,
  IExecutionContext,
  ITableRepository,
  Table,
  TableId,
} from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { ComputedFieldBackfillService } from './ComputedFieldBackfillService';
import type { ComputedUpdatePlanner } from './ComputedUpdatePlanner';

export type CascadeInput = {
  table: Table;
  selfBackfillFieldIds: ReadonlyArray<FieldId>;
  valueChangedFieldIds: ReadonlyArray<FieldId>;
  deferredBackfillFieldIds?: ReadonlyArray<FieldId>;
  /**
   * True when a field conversion changed the underlying DB column type
   * (cellValueType or isMultipleCellValue changed).  Dependent computed
   * fields may then have stale column types, so the DISTINCT optimisation
   * in the backfill UPDATE must be skipped to avoid type-mismatch errors.
   */
  hasDbStorageTypeChange?: boolean;
};

/**
 * Orchestrates self-backfill and cascade of computed field updates
 * after a field schema change (type conversion, option rename, formula expression change, etc.).
 *
 * 1. Self-backfill: recompute fields whose own definition changed (formula, lookup, rollup)
 * 2. Plan: use ComputedUpdatePlanner to find dependent computed fields in dependency order
 * 3. Cascade: backfill each dependency level in order
 */
@injectable()
export class ComputedFieldCascadeAfterSchemaUpdate {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly planner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldBackfillService)
    private readonly backfillService: ComputedFieldBackfillService,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository
  ) {}

  async cascade(
    context: IExecutionContext,
    input: CascadeInput
  ): Promise<Result<void, DomainError>> {
    const service = this;
    return safeTry<void, DomainError>(async function* () {
      const {
        table,
        selfBackfillFieldIds,
        valueChangedFieldIds,
        deferredBackfillFieldIds = [],
        hasDbStorageTypeChange,
      } = input;
      const backfilledFieldIdSet = new Set<string>();
      const deferredFieldIdSet = new Set(
        deferredBackfillFieldIds.map((fieldId) => fieldId.toString())
      );

      const filterDeferredIds = (fieldIds: ReadonlyArray<FieldId>): FieldId[] =>
        fieldIds.filter((fieldId) => !deferredFieldIdSet.has(fieldId.toString()));

      const filterDeferredFields = (fields: ReadonlyArray<Field>): Field[] =>
        fields.filter((field) => !deferredFieldIdSet.has(field.id().toString()));

      const filterAlreadyBackfilledFields = (fields: ReadonlyArray<Field>): Field[] =>
        fields.filter((field) => !backfilledFieldIdSet.has(field.id().toString()));

      const markBackfilled = (fields: ReadonlyArray<Field>): void => {
        for (const field of fields) {
          backfilledFieldIdSet.add(field.id().toString());
        }
      };

      const eligibleSelfBackfillFieldIds = filterDeferredIds(selfBackfillFieldIds);
      const eligibleValueChangedFieldIds = filterDeferredIds(valueChangedFieldIds);

      // Step 1: Self-backfill computed fields whose definition changed
      if (eligibleSelfBackfillFieldIds.length > 0) {
        const fields = filterAlreadyBackfilledFields(
          filterDeferredFields(resolveFields(table, eligibleSelfBackfillFieldIds))
        );
        if (fields.length > 0) {
          yield* await service.backfillService.backfillMany(context, {
            table,
            fields,
            skipDistinctFilter: hasDbStorageTypeChange,
            includeOneManyTwoWay: true,
          });
          markBackfilled(fields);
        }
      }

      const allChangedFieldIds = dedup([
        ...eligibleSelfBackfillFieldIds,
        ...eligibleValueChangedFieldIds,
      ]);
      if (allChangedFieldIds.length === 0) return ok(undefined);

      {
        const changedFieldIdsByString = new Map(
          allChangedFieldIds.map((fieldId) => [fieldId.toString(), fieldId])
        );
        const unresolvedFieldIdSet = new Set(changedFieldIdsByString.keys());

        const collectChangedFields = (targetTable: Table): Field[] => {
          const fields = targetTable
            .getFields()
            .filter((field) => changedFieldIdsByString.has(field.id().toString()));
          for (const field of fields) {
            unresolvedFieldIdSet.delete(field.id().toString());
          }
          return fields;
        };

        const tableFields = filterAlreadyBackfilledFields(
          filterDeferredFields(collectChangedFields(table))
        );
        if (tableFields.length > 0) {
          yield* await service.backfillService.backfillMany(context, {
            table,
            fields: tableFields,
            skipDistinctFilter: hasDbStorageTypeChange,
            includeOneManyTwoWay: true,
          });
          markBackfilled(tableFields);
        }

        if (unresolvedFieldIdSet.size > 0) {
          const { TableByIdSpec } = await import('@teable/v2-core');
          const linkFields = table
            .getFields()
            .filter((field) => field.type().toString() === 'link') as Array<
            Field & {
              symmetricFieldId: () => FieldId | undefined;
              foreignTableId: () => TableId;
            }
          >;

          for (const linkField of linkFields) {
            if (!changedFieldIdsByString.has(linkField.id().toString())) continue;
            const symmetricFieldId = linkField.symmetricFieldId();
            if (!symmetricFieldId) continue;

            const foreignTableSpec = TableByIdSpec.create(linkField.foreignTableId());
            const foreignTableResult = await service.tableRepository.findOne(
              context,
              foreignTableSpec
            );
            if (foreignTableResult.isErr()) continue;

            const foreignTable = foreignTableResult.value;
            const symmetricFields = filterAlreadyBackfilledFields(
              resolveFieldsByIds(foreignTable, [symmetricFieldId])
            );
            if (symmetricFields.length === 0) continue;

            unresolvedFieldIdSet.delete(symmetricFieldId.toString());
            yield* await service.backfillService.backfillMany(context, {
              table: foreignTable,
              fields: filterDeferredFields(symmetricFields),
              skipDistinctFilter: hasDbStorageTypeChange,
              includeOneManyTwoWay: true,
            });
            markBackfilled(symmetricFields);
          }
        }
      }

      const plan = yield* await service.planner.plan(
        {
          table,
          changedFieldIds: allChangedFieldIds,
          changedRecordIds: [], // all records affected
          changeType: 'update',
          cyclePolicy: 'skip',
        },
        context
      );

      if (plan.steps.length === 0) return ok(undefined);

      const sortedSteps = [...plan.steps].sort((a, b) => a.level - b.level);
      for (const step of sortedSteps) {
        let targetTable: Table;
        if (step.tableId.equals(table.id())) {
          targetTable = table;
        } else {
          const { TableByIdSpec } = await import('@teable/v2-core');
          const spec = TableByIdSpec.create(step.tableId);
          const findResult = await service.tableRepository.findOne(context, spec);
          if (findResult.isErr()) continue;
          targetTable = findResult.value;
        }

        const fields = filterAlreadyBackfilledFields(
          filterDeferredFields(resolveFieldsByIds(targetTable, step.fieldIds))
        );
        if (fields.length === 0) continue;

        yield* await service.backfillService.backfillMany(context, {
          table: targetTable,
          fields,
          skipDistinctFilter: hasDbStorageTypeChange,
          includeOneManyTwoWay: true,
        });
        markBackfilled(fields);
      }

      return ok(undefined);
    });
  }
}

const resolveFields = (table: Table, fieldIds: ReadonlyArray<FieldId>): Field[] => {
  const idSet = new Set(fieldIds.map((id) => id.toString()));
  return table.getFields().filter((f) => idSet.has(f.id().toString()));
};

const resolveFieldsByIds = (table: Table, fieldIds: ReadonlyArray<FieldId>): Field[] => {
  const idSet = new Set(fieldIds.map((id) => id.toString()));
  return table.getFields().filter((f) => idSet.has(f.id().toString()));
};

const dedup = (fieldIds: ReadonlyArray<FieldId>): FieldId[] => {
  const seen = new Map<string, FieldId>();
  for (const id of fieldIds) {
    seen.set(id.toString(), id);
  }
  return [...seen.values()];
};
