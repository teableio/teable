import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import { FieldType } from '../domain/table/fields/FieldType';
import { LinkField } from '../domain/table/fields/types/LinkField';
import type { Table } from '../domain/table/Table';
import type {
  PhysicalTableDuplicateColumn,
  PhysicalTableDuplicatePlan,
} from '../ports/TableRecordRepository';

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * Link fields (junction / FK host tables) need more than a main-table INSERT…SELECT.
 * Keep the row-hydration path for tables that include any link field.
 */
export const canUsePhysicalTableDuplicate = (sourceTable: Table): boolean => {
  return !sourceTable.getFields().some((field) => field.type().equals(FieldType.link()));
};

const resolveDbFieldName = (field: Field): Result<string, DomainError> =>
  field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());

/**
 * Build an INSERT…SELECT plan that preserves source `__id` values (V1 semantics)
 * and remaps field/view physical columns via the duplicate id maps.
 */
export const buildPhysicalTableDuplicatePlan = (params: {
  sourceTable: Table;
  targetTable: Table;
  fieldIdMap: ReadonlyMap<string, string>;
  viewIdMap: ReadonlyMap<string, string>;
}): Result<PhysicalTableDuplicatePlan, DomainError> => {
  return safeTry<PhysicalTableDuplicatePlan, DomainError>(function* () {
    if (!canUsePhysicalTableDuplicate(params.sourceTable)) {
      return err(
        domainError.validation({
          message: 'Physical table duplicate requires a source table without link fields',
        })
      );
    }

    const sourceDbTableName = yield* params.sourceTable.dbTableName();
    const sourceTableName = yield* sourceDbTableName.value();
    const targetDbTableName = yield* params.targetTable.dbTableName();
    const targetTableName = yield* targetDbTableName.value();

    const targetFieldsById = new Map(
      params.targetTable.getFields().map((field) => [field.id().toString(), field] as const)
    );

    const columns: PhysicalTableDuplicateColumn[] = [
      { targetColumn: '__id', sourceSql: quoteIdent('__id') },
      { targetColumn: '__created_by', sourceSql: quoteIdent('__created_by') },
      { targetColumn: '__version', sourceSql: '1' },
    ];

    // Include computed fields (formula/lookup/rollup/…) as well as editable ones.
    // V2 stores those as ordinary columns (not PG GENERATED), so INSERT…SELECT can
    // copy values without a post-insert computed outbox recompute. Link fields are
    // excluded by canUsePhysicalTableDuplicate; button has no durable cell payload.
    for (const sourceField of params.sourceTable.getFields()) {
      if (sourceField.type().equals(FieldType.button())) {
        continue;
      }
      if (sourceField instanceof LinkField || sourceField.type().equals(FieldType.link())) {
        continue;
      }

      const sourceFieldId = sourceField.id().toString();
      const targetFieldId = params.fieldIdMap.get(sourceFieldId);
      if (!targetFieldId) {
        continue;
      }
      const targetField = targetFieldsById.get(targetFieldId);
      if (!targetField) {
        continue;
      }

      // Skip meta-only fields without a physical column rather than failing the plan.
      const sourceColumnResult = resolveDbFieldName(sourceField);
      const targetColumnResult = resolveDbFieldName(targetField);
      if (sourceColumnResult.isErr() || targetColumnResult.isErr()) {
        continue;
      }

      columns.push({
        targetColumn: targetColumnResult.value,
        sourceSql: quoteIdent(sourceColumnResult.value),
      });
    }

    const ensureTargetOrderColumns: string[] = [];
    for (const [sourceViewId, targetViewId] of params.viewIdMap.entries()) {
      ensureTargetOrderColumns.push(targetViewId);
      columns.push({
        targetColumn: `__row_${targetViewId}`,
        // Source column may be absent on tables that never materialised view order;
        // the adapter drops mappings whose source column does not exist.
        sourceSql: quoteIdent(`__row_${sourceViewId}`),
      });
    }

    return ok({
      sourceTableName,
      targetTableName,
      columns,
      ensureTargetOrderColumns,
    });
  });
};
