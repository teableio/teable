import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { LinkForeignTableReferenceVisitor } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import {
  implementsOnTeableFieldDeleted,
  type FieldDeletionContext,
} from '../../domain/table/OnTeableFieldDeleted';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableUpdateViewColumnMetaSpec } from '../../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { TableUpdateViewOptionsSpec } from '../../domain/table/specs/TableUpdateViewOptionsSpec';
import { TableUpdateViewQueryDefaultsSpec } from '../../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { ViewFieldDeletionUpdate } from '../../domain/table/views/OnTeableViewFieldDeleted';
import { implementsOnTeableViewFieldDeleted } from '../../domain/table/views/OnTeableViewFieldDeleted';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableMapper } from '../../ports/mappers/TableMapper';
import type { ITableRepository } from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import type {
  FieldDeletionSideEffectPreparation,
  FieldDeletionSideEffectService,
} from './FieldDeletionSideEffectService';
import type { IForeignTableLoaderService } from './ForeignTableLoaderService';

export type FieldDeletionPreparationInput = {
  readonly baseId: BaseId;
  readonly tableId: TableId;
  readonly fieldIds: ReadonlyArray<FieldId>;
};

export type FieldDeletionTarget = {
  readonly kind: 'direct' | 'symmetric';
  readonly tableId: string;
  readonly tableName: string;
  readonly fieldId: string;
  readonly fieldName: string;
};

export type FieldDeletionDependentFieldEffect = {
  readonly tableId: string;
  readonly tableName: string;
  readonly fieldId: string;
  readonly fieldName: string;
  readonly deletedFieldId: string;
};

export type FieldDeletionViewEffect = {
  readonly tableId: string;
  readonly tableName: string;
  readonly viewId: string;
  readonly viewName: string;
  readonly deletedFieldId: string;
  readonly changes: ReadonlyArray<'columnMeta' | 'options' | 'queryDefaults'>;
};

export type FieldDeletionMissingMetadata = {
  readonly kind: 'foreignTable';
  readonly tableId: string;
  readonly referencedByFieldId: string;
  readonly reason: 'foreign-table-not-loaded';
};

export type FieldDeletionCleanupPreparation = {
  readonly tableId: string;
  readonly deletedFieldId: string;
  readonly spec: ISpecification<Table, ITableSpecVisitor>;
};

/** Internal application facts. Executable specifications and aggregates must not enter preview DTOs. */
export type FieldDeletionPreparation = {
  readonly table: Table;
  readonly projectedTable: Table;
  readonly targetFields: ReadonlyArray<Field>;
  readonly foreignTables: ReadonlyArray<Table>;
  readonly directTargets: ReadonlyArray<FieldDeletionTarget>;
  readonly symmetricTargets: ReadonlyArray<FieldDeletionTarget>;
  readonly dependentFields: ReadonlyArray<FieldDeletionDependentFieldEffect>;
  readonly snapshotFields: ReadonlyArray<FieldDeletionDependentFieldEffect>;
  readonly views: ReadonlyArray<FieldDeletionViewEffect>;
  readonly missingMetadata: ReadonlyArray<FieldDeletionMissingMetadata>;
  readonly sideEffects: FieldDeletionSideEffectPreparation;
  readonly cleanup: ReadonlyArray<FieldDeletionCleanupPreparation>;
  readonly tablesBeforeDeletionById: ReadonlyMap<string, Table>;
};

type DeletionCleanup = {
  readonly spec?: ISpecification<Table, ITableSpecVisitor>;
  readonly dependentFields: ReadonlyArray<FieldDeletionDependentFieldEffect>;
  readonly snapshotFields: ReadonlyArray<FieldDeletionDependentFieldEffect>;
  readonly views: ReadonlyArray<FieldDeletionViewEffect>;
};

type DeletionTargetState = {
  readonly kind: FieldDeletionTarget['kind'];
  readonly table: Table;
  readonly previousTable: Table;
  readonly deletedField: Field;
};

const fieldTarget = (
  kind: FieldDeletionTarget['kind'],
  table: Table,
  field: Field
): FieldDeletionTarget => ({
  kind,
  tableId: table.id().toString(),
  tableName: table.name().toString(),
  fieldId: field.id().toString(),
  fieldName: field.name().toString(),
});

const changesFromViewUpdate = (
  update: ViewFieldDeletionUpdate
): FieldDeletionViewEffect['changes'] => [
  ...(update.columnMeta ? (['columnMeta'] as const) : []),
  ...(update.options ? (['options'] as const) : []),
  ...(update.queryDefaults ? (['queryDefaults'] as const) : []),
];

/**
 * Shared read-only field deletion preparation. It performs repository reads and detached aggregate
 * mutations only; snapshots, persistence, events, undo, schema lifecycle, and external hooks are
 * deliberately absent.
 */
@injectable()
export class FieldDeletionPreparationService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: Pick<ITableRepository, 'findOne' | 'find'>,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: Pick<IForeignTableLoaderService, 'load'>,
    @inject(v2CoreTokens.fieldDeletionSideEffectService)
    private readonly fieldDeletionSideEffectService: Pick<
      FieldDeletionSideEffectService,
      'prepare'
    >,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper
  ) {}

  async prepare(
    context: IExecutionContext,
    input: FieldDeletionPreparationInput,
    options?: { readonly table?: Table }
  ): Promise<Result<FieldDeletionPreparation, DomainError>> {
    const service = this;
    return safeTry<FieldDeletionPreparation, DomainError>(async function* () {
      let table = options?.table;
      if (!table) {
        const tableSpec = yield* Table.specs(input.baseId).byId(input.tableId).build();
        const tableResult = await service.tableRepository.findOne(context, tableSpec);
        if (tableResult.isErr()) {
          return err(
            isNotFoundError(tableResult.error)
              ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
              : tableResult.error
          );
        }
        table = tableResult.value;
      }
      const detachedTable = yield* table.clone(service.tableMapper);
      const targetFields = yield* service.resolveTargetFields(detachedTable, input.fieldIds);
      const referenceVisitor = new LinkForeignTableReferenceVisitor();
      const references = yield* referenceVisitor.collect(targetFields);
      const foreignTables = yield* await service.foreignTableLoaderService.load(context, {
        references,
        allowMissing: true,
      });
      const loadedForeignIds = new Set(foreignTables.map((item) => item.id().toString()));
      const missingMetadata: FieldDeletionMissingMetadata[] = [];
      for (const targetField of targetFields) {
        const fieldReferences = yield* referenceVisitor.collect([targetField]);
        for (const reference of fieldReferences) {
          const tableId = reference.foreignTableId.toString();
          if (!loadedForeignIds.has(tableId)) {
            missingMetadata.push({
              kind: 'foreignTable',
              tableId,
              referencedByFieldId: targetField.id().toString(),
              reason: 'foreign-table-not-loaded',
            });
          }
        }
      }

      const directUpdate = yield* detachedTable.update((mutator) => {
        let next = mutator;
        for (const fieldId of input.fieldIds) next = next.removeField(fieldId);
        return next;
      });
      const projectedTable = directUpdate.table;
      const directViewEffects: FieldDeletionViewEffect[] = [];
      for (const view of table.views()) {
        const columnMeta = yield* view.columnMeta();
        const columnMetaDto = columnMeta.toDto();
        for (const targetField of targetFields) {
          if (!Object.hasOwn(columnMetaDto, targetField.id().toString())) continue;
          directViewEffects.push({
            tableId: table.id().toString(),
            tableName: table.name().toString(),
            viewId: view.id().toString(),
            viewName: view.name().toString(),
            deletedFieldId: targetField.id().toString(),
            changes: ['columnMeta'],
          });
        }
      }
      const preparedSideEffects = yield* service.fieldDeletionSideEffectService.prepare({
        table: projectedTable,
        fields: targetFields,
        foreignTables,
      });
      const directTargetIds = new Set(targetFields.map((field) => field.id().toString()));
      // When a bulk delete names both halves of a self link, the direct projection already
      // removes both fields. Its two reciprocal symmetric removals are therefore obsolete.
      // Filter only that exact overlap; all foreign-table symmetric work remains required.
      const sideEffects: FieldDeletionSideEffectPreparation = {
        sideEffects: preparedSideEffects.sideEffects.filter(
          (sideEffect) =>
            !(
              sideEffect.deletedField &&
              sideEffect.foreignTable.id().equals(table.id()) &&
              directTargetIds.has(sideEffect.deletedField.id().toString())
            )
        ),
      };

      const allTablesSpec = yield* Table.specs(input.baseId).build();
      const allTables = yield* await service.tableRepository.find(context, allTablesSpec);
      const tableCandidatesById = new Map<string, Table>(
        allTables.map((candidate) => [candidate.id().toString(), candidate] as const)
      );
      for (const foreignTable of foreignTables) {
        if (!tableCandidatesById.has(foreignTable.id().toString())) {
          tableCandidatesById.set(foreignTable.id().toString(), foreignTable);
        }
      }

      const tablesById = new Map<string, Table>();
      for (const [tableId, candidate] of tableCandidatesById) {
        if (tableId === projectedTable.id().toString()) continue;
        tablesById.set(tableId, yield* candidate.clone(service.tableMapper));
      }
      tablesById.set(projectedTable.id().toString(), projectedTable);

      const beforeCandidatesById = new Map(tableCandidatesById);
      beforeCandidatesById.set(table.id().toString(), table);
      const tablesBeforeDeletionById = new Map<string, Table>();
      for (const [tableId, candidate] of beforeCandidatesById) {
        tablesBeforeDeletionById.set(tableId, yield* candidate.clone(service.tableMapper));
      }

      const deletionTargets: DeletionTargetState[] = targetFields.map((deletedField) => ({
        kind: 'direct',
        table: projectedTable,
        previousTable: table,
        deletedField,
      }));
      const symmetricTargets: FieldDeletionTarget[] = [];
      for (const sideEffect of sideEffects.sideEffects) {
        const current = tablesById.get(sideEffect.foreignTable.id().toString());
        if (!current) continue;
        const updated = yield* sideEffect.mutateSpec.mutate(current);
        tablesById.set(updated.id().toString(), updated);
        if (sideEffect.deletedField) {
          deletionTargets.push({
            kind: 'symmetric',
            table: updated,
            previousTable: current,
            deletedField: sideEffect.deletedField,
          });
          symmetricTargets.push(fieldTarget('symmetric', current, sideEffect.deletedField));
        }
      }

      const cleanup: FieldDeletionCleanupPreparation[] = [];
      const dependentFields: FieldDeletionDependentFieldEffect[] = [];
      const snapshotFields: FieldDeletionDependentFieldEffect[] = [];
      const views: FieldDeletionViewEffect[] = [...directViewEffects];
      for (const deletion of deletionTargets) {
        const sourceTableId = deletion.table.id().toString();
        const orderedTableIds = [sourceTableId];
        for (const tableId of tablesById.keys()) {
          if (tableId !== sourceTableId) {
            orderedTableIds.push(tableId);
          }
        }
        let latestSourceTable = tablesById.get(sourceTableId) ?? deletion.table;
        for (const tableId of orderedTableIds) {
          const current = tablesById.get(tableId);
          if (!current) continue;
          const candidate = tableId === sourceTableId ? latestSourceTable : current;
          const preparedCleanup = yield* buildFieldDeletionCleanup(
            candidate,
            deletion.deletedField,
            {
              table: candidate,
              sourceTable: latestSourceTable,
              previousSourceTable: deletion.previousTable,
            }
          );
          dependentFields.push(...preparedCleanup.dependentFields);
          snapshotFields.push(...preparedCleanup.snapshotFields);
          views.push(...preparedCleanup.views);
          if (!preparedCleanup.spec) continue;
          cleanup.push({
            tableId,
            deletedFieldId: deletion.deletedField.id().toString(),
            spec: preparedCleanup.spec,
          });
          const updated = yield* preparedCleanup.spec.mutate(candidate);
          tablesById.set(tableId, updated);
          if (tableId === sourceTableId) latestSourceTable = updated;
        }
      }
      const viewsByResource = new Map<string, FieldDeletionViewEffect>();
      for (const effect of views) {
        const key = `${effect.tableId}:${effect.viewId}:${effect.deletedFieldId}`;
        const current = viewsByResource.get(key);
        viewsByResource.set(
          key,
          current
            ? { ...current, changes: [...new Set([...current.changes, ...effect.changes])] }
            : effect
        );
      }

      return ok({
        table,
        projectedTable,
        targetFields,
        foreignTables,
        directTargets: targetFields.map((field) => fieldTarget('direct', table, field)),
        symmetricTargets,
        dependentFields,
        snapshotFields,
        views: [...viewsByResource.values()],
        missingMetadata,
        sideEffects,
        cleanup,
        tablesBeforeDeletionById,
      });
    });
  }

  private resolveTargetFields(
    table: Table,
    fieldIds: ReadonlyArray<FieldId>
  ): Result<ReadonlyArray<Field>, DomainError> {
    const fields: Field[] = [];
    for (const fieldId of fieldIds) {
      const targetField = table.getFields((field) => field.id().equals(fieldId))[0];
      if (!targetField) return err(domainError.notFound({ message: 'Field not found' }));
      fields.push(targetField);
    }
    return ok(fields);
  }
}

export const buildFieldDeletionCleanup = (
  candidateTable: Table,
  deletedField: Field,
  context: FieldDeletionContext
): Result<DeletionCleanup, DomainError> => {
  const specs: Array<ISpecification<Table, ITableSpecVisitor>> = [];
  const dependentFields: FieldDeletionDependentFieldEffect[] = [];
  const snapshotFields: FieldDeletionDependentFieldEffect[] = [];
  const views: FieldDeletionViewEffect[] = [];

  for (const view of candidateTable.views()) {
    if (!implementsOnTeableViewFieldDeleted(view)) continue;
    const result = view.onFieldDeleted(deletedField, context);
    if (result.isErr()) return err(result.error);
    const update = result.value;
    if (!update) continue;
    const changes = changesFromViewUpdate(update);
    if (changes.length > 0) {
      views.push({
        tableId: candidateTable.id().toString(),
        tableName: candidateTable.name().toString(),
        viewId: update.viewId.toString(),
        viewName: view.name().toString(),
        deletedFieldId: deletedField.id().toString(),
        changes,
      });
    }
    if (update.columnMeta) {
      specs.push(
        TableUpdateViewColumnMetaSpec.create(candidateTable, [
          {
            viewId: update.viewId,
            fieldId: update.fieldId,
            columnMeta: update.columnMeta,
            ...(update.options
              ? {
                  previousOptions: update.options.previousOptions,
                  nextOptions: update.options.nextOptions,
                  optionsChanged: true,
                }
              : {}),
          },
        ])
      );
    } else if (update.options) {
      specs.push(
        TableUpdateViewOptionsSpec.create({
          viewId: update.viewId,
          previousOptions: update.options.previousOptions,
          nextOptions: update.options.nextOptions,
        })
      );
    }
    if (update.queryDefaults) {
      const previousQueryDefaultsResult = view.queryDefaults();
      if (previousQueryDefaultsResult.isErr()) return err(previousQueryDefaultsResult.error);
      specs.push(
        TableUpdateViewQueryDefaultsSpec.create([
          {
            viewId: update.viewId,
            previousQueryDefaults: previousQueryDefaultsResult.value,
            queryDefaults: update.queryDefaults,
          },
        ])
      );
    }
  }

  for (const field of candidateTable.getFields()) {
    if (!implementsOnTeableFieldDeleted(field)) continue;
    const result = field.onFieldDeleted(deletedField, context);
    if (result.isErr()) return err(result.error);
    if (!result.value) continue;
    specs.push(result.value.spec);
    dependentFields.push({
      tableId: candidateTable.id().toString(),
      tableName: candidateTable.name().toString(),
      fieldId: field.id().toString(),
      fieldName: field.name().toString(),
      deletedFieldId: deletedField.id().toString(),
    });
    for (const relatedFieldId of result.value.relatedFieldIds) {
      const relatedField = candidateTable.getFields((candidate) =>
        candidate.id().equals(relatedFieldId)
      )[0];
      if (!relatedField) continue;
      snapshotFields.push({
        tableId: candidateTable.id().toString(),
        tableName: candidateTable.name().toString(),
        fieldId: relatedField.id().toString(),
        fieldName: relatedField.name().toString(),
        deletedFieldId: deletedField.id().toString(),
      });
    }
  }

  return ok({
    spec: composeAndSpecsOrUndefined(specs),
    dependentFields,
    snapshotFields,
    views,
  });
};
