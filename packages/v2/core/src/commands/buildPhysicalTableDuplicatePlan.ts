import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import { FieldType } from '../domain/table/fields/FieldType';
import { LinkField } from '../domain/table/fields/types/LinkField';
import type { Table } from '../domain/table/Table';
import type {
  PhysicalJunctionCopy,
  PhysicalTableDuplicateColumn,
  PhysicalTableDuplicatePlan,
} from '../ports/TableRecordRepository';

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const isLinkField = (field: Field): field is LinkField => field instanceof LinkField;

const isSelfLinkField = (field: LinkField, table: Table): boolean =>
  field.foreignTableId().equals(table.id());

/**
 * Physical bulk path supports:
 * - tables with no link fields (T6153)
 * - tables whose link fields are all **external** (not self-link) and whose
 *   storage is either host-table FK columns or junction tables (T6156 Phase A)
 *
 * Self-links still use the hydrate path (record-id remaps / symmetric pairs).
 */
export const canUsePhysicalTableDuplicate = (sourceTable: Table): boolean => {
  for (const field of sourceTable.getFields()) {
    if (!isLinkField(field)) {
      continue;
    }
    if (isSelfLinkField(field, sourceTable)) {
      return false;
    }
  }
  return true;
};

const resolveDbFieldName = (field: Field): Result<string, DomainError> =>
  field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());

const isJunctionHost = (fkHostTableName: string): boolean => fkHostTableName.includes('junction_');

const asLinkField = (field: Field): LinkField | undefined => {
  if (field instanceof LinkField) {
    return field;
  }
  return undefined;
};

/**
 * Build an INSERT…SELECT plan that preserves source `__id` values (V1 semantics)
 * and remaps field/view physical columns via the duplicate id maps.
 *
 * For external links (T6156 Phase A):
 * - host-table FK columns (`__fk_*` on main table) are remapped into `columns`
 * - junction tables are listed in `junctionCopies` for a follow-up INSERT…SELECT
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
          message: 'Physical table duplicate does not support self-link fields; use hydrate path',
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

    const mappedMainColumns = new Set<string>(['__id', '__created_by', '__version']);

    // Non-link durable columns (including computed/formula stored values).
    for (const sourceField of params.sourceTable.getFields()) {
      if (sourceField.type().equals(FieldType.button())) {
        continue;
      }
      if (isLinkField(sourceField)) {
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

      const sourceColumnResult = resolveDbFieldName(sourceField);
      const targetColumnResult = resolveDbFieldName(targetField);
      if (sourceColumnResult.isErr() || targetColumnResult.isErr()) {
        continue;
      }
      if (mappedMainColumns.has(targetColumnResult.value)) {
        continue;
      }
      mappedMainColumns.add(targetColumnResult.value);

      columns.push({
        targetColumn: targetColumnResult.value,
        sourceSql: quoteIdent(sourceColumnResult.value),
      });
    }

    const junctionCopies: PhysicalJunctionCopy[] = [];
    const junctionPairKeys = new Set<string>();

    for (const sourceField of params.sourceTable.getFields()) {
      const sourceLink = asLinkField(sourceField);
      if (!sourceLink) {
        continue;
      }

      const sourceFieldId = sourceLink.id().toString();
      const targetFieldId = params.fieldIdMap.get(sourceFieldId);
      if (!targetFieldId) {
        continue;
      }
      const targetField = targetFieldsById.get(targetFieldId);
      const targetLink = targetField ? asLinkField(targetField) : undefined;
      if (!targetLink) {
        continue;
      }

      if (!sourceLink.config().hasDbConfig() || !targetLink.config().hasDbConfig()) {
        return err(
          domainError.validation({
            message: `Physical table duplicate requires link db config for field ${sourceFieldId}`,
          })
        );
      }

      const sourceFkHost = yield* sourceLink.fkHostTableNameString();
      const targetFkHost = yield* targetLink.fkHostTableNameString();
      const sourceSelfKey = yield* sourceLink.selfKeyNameString();
      const sourceForeignKey = yield* sourceLink.foreignKeyNameString();
      const targetSelfKey = yield* targetLink.selfKeyNameString();
      const targetForeignKey = yield* targetLink.foreignKeyNameString();

      // Link cell payload column on the main table (jsonb titles/ids used by reads).
      const sourceCellColumnResult = resolveDbFieldName(sourceLink);
      const targetCellColumnResult = resolveDbFieldName(targetLink);
      if (sourceCellColumnResult.isOk() && targetCellColumnResult.isOk()) {
        const targetCellColumn = targetCellColumnResult.value;
        if (!mappedMainColumns.has(targetCellColumn)) {
          mappedMainColumns.add(targetCellColumn);
          columns.push({
            targetColumn: targetCellColumn,
            sourceSql: quoteIdent(sourceCellColumnResult.value),
          });
        }
      }

      // Host-table FK storage (manyOne / oneOne): copy non-__id key columns on main table.
      if (sourceFkHost === sourceTableName && targetFkHost === targetTableName) {
        for (const [sourceKey, targetKey] of [
          [sourceSelfKey, targetSelfKey],
          [sourceForeignKey, targetForeignKey],
        ] as const) {
          if (sourceKey === '__id' || targetKey === '__id') {
            continue;
          }
          if (mappedMainColumns.has(targetKey)) {
            continue;
          }
          mappedMainColumns.add(targetKey);
          columns.push({
            targetColumn: targetKey,
            sourceSql: quoteIdent(sourceKey),
          });
        }
        continue;
      }

      // Junction storage (manyMany, one-way oneMany, …).
      if (isJunctionHost(sourceFkHost) && isJunctionHost(targetFkHost)) {
        const pairKey = `${sourceFkHost}:${targetFkHost}`;
        if (junctionPairKeys.has(pairKey)) {
          continue;
        }
        junctionPairKeys.add(pairKey);
        junctionCopies.push({
          sourceJunctionTable: sourceFkHost,
          targetJunctionTable: targetFkHost,
          sourceSelfKey,
          sourceForeignKey,
          targetSelfKey,
          targetForeignKey,
        });
        continue;
      }

      // e.g. two-way oneMany hosted on the foreign table — not Phase A.
      return err(
        domainError.validation({
          message: `Physical table duplicate cannot map link storage for field ${sourceFieldId} (sourceHost=${sourceFkHost}, targetHost=${targetFkHost})`,
        })
      );
    }

    const ensureTargetOrderColumns: string[] = [];
    for (const [sourceViewId, targetViewId] of params.viewIdMap.entries()) {
      ensureTargetOrderColumns.push(targetViewId);
      columns.push({
        targetColumn: `__row_${targetViewId}`,
        sourceSql: quoteIdent(`__row_${sourceViewId}`),
      });
    }

    return ok({
      sourceTableName,
      targetTableName,
      columns,
      ensureTargetOrderColumns,
      junctionCopies,
    });
  });
};
