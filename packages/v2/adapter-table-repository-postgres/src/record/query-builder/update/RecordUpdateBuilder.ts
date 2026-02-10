import { FieldId, FieldType, domainError, ok } from '@teable/v2-core';
import type {
  ClearFieldValueSpec,
  DomainError,
  ICellValueSpec,
  ICellValueSpecVisitor,
  ISpecification,
  ISpecVisitor,
  LinkField,
  RecordId,
  SetAttachmentValueSpec,
  SetCheckboxValueSpec,
  SetDateValueSpec,
  SetLinkValueByTitleSpec,
  SetLongTextValueSpec,
  SetMultipleSelectValueSpec,
  SetNumberValueSpec,
  SetRowOrderValueSpec,
  SetRatingValueSpec,
  SetSingleLineTextValueSpec,
  SetSingleSelectValueSpec,
  SetUserValueSpec,
  SetUserValueByIdentifierSpec,
  Table,
  TableId,
  SetLinkValueSpec,
} from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { UpdateImpactHint } from '../../computed';
import {
  LinkChangeCollectorVisitor,
  LinkExclusivityConstraintCollector,
  createEmptyCollectedLinkChanges,
  mergeCollectedLinkChange,
  type CollectedLinkChanges,
  type LinkExclusivityConstraint,
} from '../../visitors';
import { CellValueMutateVisitor } from '../../visitors/CellValueMutateVisitor';
import type { CompiledSqlStatement, LinkedRecordLockInfo } from '../insert';
import type { DynamicDB } from '../ITableRecordQueryBuilder';

/**
 * Result of building UPDATE SQLs for a record (compiled form).
 */
export interface RecordUpdateSqlResult {
  /** The main UPDATE statement */
  mainUpdate: CompiledSqlStatement;
  /** Additional SQL statements (junction table updates, FK updates for link fields) */
  additionalStatements: CompiledSqlStatement[];
  /** Field IDs that were changed (for computed field propagation) */
  changedFieldIds: FieldId[];
  /** Computed update impact (used for propagation planning) */
  impact: RecordUpdateImpact;
  /** Foreign record IDs that need advisory locks to prevent deadlocks */
  linkedRecordLocks: LinkedRecordLockInfo[];
}

/**
 * Context for building update data.
 */
export interface RecordUpdateBuilderContext {
  actorId: string;
  now: string;
  actorName?: string;
  actorEmail?: string;
}

export type RecordUpdateSeedGroup = {
  tableId: TableId;
  recordIds: RecordId[];
};

export type RecordUpdateImpact = {
  impactHint: UpdateImpactHint;
  extraSeedRecords: ReadonlyArray<RecordUpdateSeedGroup>;
  linkChanges: CollectedLinkChanges;
  valueFieldIds: ReadonlyArray<FieldId>;
  linkedRecordLocks: LinkedRecordLockInfo[];
  /** Exclusivity constraints that need validation before persisting */
  exclusivityConstraints: ReadonlyArray<LinkExclusivityConstraint>;
};

/**
 * Builds UPDATE SQL statements for a record using mutation specification.
 *
 * This builder delegates to CellValueMutateVisitor to generate SQL statements,
 * then wraps them with descriptions for EXPLAIN analysis.
 *
 * @example
 * ```typescript
 * const builder = new RecordUpdateBuilder(db);
 * const result = await builder.build({
 *   table,
 *   tableName: 'my_table',
 *   mutateSpec,
 *   recordId: 'rec_xxx',
 *   context: { actorId: 'usr_xxx', now: new Date().toISOString() },
 * });
 * ```
 */
export class RecordUpdateBuilder {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  /**
   * Build UPDATE SQL statements for a record using mutation specification.
   * Use this for EXPLAIN analysis or when you need the actual SQL strings.
   */
  async build(params: {
    table: Table;
    tableName: string;
    tableDisplayName?: string;
    mutateSpec: ICellValueSpec;
    recordId: string;
    context: RecordUpdateBuilderContext;
  }): Promise<Result<RecordUpdateSqlResult, DomainError>> {
    const { table, tableName, tableDisplayName, mutateSpec, recordId, context } = params;
    const db = this.db;
    const builder = this;

    return safeTry<RecordUpdateSqlResult, DomainError>(async function* () {
      // Use CellValueMutateVisitor to generate all SQL statements
      const mutateVisitor = CellValueMutateVisitor.create(db, table, tableName, {
        recordId,
        actorId: context.actorId,
        now: context.now,
        actorName: context.actorName,
        actorEmail: context.actorEmail,
      });

      yield* mutateSpec.accept(mutateVisitor);
      const statementsResult = mutateVisitor.build();
      if (statementsResult.isErr()) {
        return err(statementsResult.error);
      }

      const { mainUpdate, additionalStatements, changedFieldIds } = statementsResult.value;

      const impactResult = await builder.collectUpdateImpact({
        table,
        tableName,
        recordId,
        mutateSpec,
        changedFieldIds,
      });
      if (impactResult.isErr()) {
        return err(impactResult.error);
      }

      // Wrap with descriptions for EXPLAIN analysis
      return ok({
        mainUpdate: {
          description: `Update record in ${tableDisplayName ?? tableName}`,
          compiled: mainUpdate,
        },
        additionalStatements: additionalStatements.map((stmt, index) => ({
          description: `Additional statement ${index + 1}`,
          compiled: stmt,
        })),
        changedFieldIds,
        impact: impactResult.value,
        linkedRecordLocks: impactResult.value.linkedRecordLocks,
      });
    });
  }

  private async collectUpdateImpact(params: {
    table: Table;
    tableName: string;
    recordId: string;
    mutateSpec: ICellValueSpec;
    changedFieldIds: ReadonlyArray<FieldId>;
  }): Promise<Result<RecordUpdateImpact, DomainError>> {
    const { table, tableName, recordId, mutateSpec, changedFieldIds } = params;
    const valueFieldIds: FieldId[] = [];

    for (const fieldId of changedFieldIds) {
      const fieldResult = table.getField((candidate) => candidate.id().equals(fieldId));
      if (fieldResult.isErr()) {
        return err(fieldResult.error);
      }
      const field = fieldResult.value;
      if (!field.type().equals(FieldType.link())) {
        valueFieldIds.push(fieldId);
      }
    }

    const linkChangesResult = await collectLinkChanges({
      db: this.db,
      table,
      tableName,
      recordId,
      mutateSpec,
    });
    if (linkChangesResult.isErr()) {
      return err(linkChangesResult.error);
    }
    const { linkChanges, exclusivityConstraints } = linkChangesResult.value;

    const extraSeedRecordsResult = buildExtraSeedRecordsFromLinkChanges(linkChanges);
    if (extraSeedRecordsResult.isErr()) {
      return err(extraSeedRecordsResult.error);
    }

    // Collect linked record locks from link changes
    const linkedRecordLocks = buildLinkedRecordLocksFromLinkChanges(linkChanges);

    return ok({
      impactHint: buildImpactHint(valueFieldIds, linkChanges.relationChangeFieldIds),
      extraSeedRecords: extraSeedRecordsResult.value,
      linkChanges,
      valueFieldIds,
      linkedRecordLocks,
      exclusivityConstraints,
    });
  }
}

class LinkValueCollectorVisitor implements ICellValueSpecVisitor {
  private readonly linkValues = new Map<string, unknown>();

  values(): ReadonlyMap<string, unknown> {
    return this.linkValues;
  }

  visitSetSingleLineTextValue(_spec: SetSingleLineTextValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLongTextValue(_spec: SetLongTextValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetNumberValue(_spec: SetNumberValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetRatingValue(_spec: SetRatingValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetSingleSelectValue(_spec: SetSingleSelectValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetMultipleSelectValue(_spec: SetMultipleSelectValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetCheckboxValue(_spec: SetCheckboxValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetDateValue(_spec: SetDateValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetAttachmentValue(_spec: SetAttachmentValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetUserValue(_spec: SetUserValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetUserValueByIdentifier(_spec: SetUserValueByIdentifierSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLinkValue(spec: SetLinkValueSpec): Result<void, DomainError> {
    this.linkValues.set(spec.fieldId.toString(), spec.value.toValue());
    return ok(undefined);
  }

  visitSetLinkValueByTitle(_spec: SetLinkValueByTitleSpec): Result<void, DomainError> {
    // SetLinkValueByTitle doesn't have resolved IDs yet, so we don't collect link values
    // The title resolution should happen before this point
    return ok(undefined);
  }

  visitSetRowOrderValue(_spec: SetRowOrderValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitClearFieldValue(spec: ClearFieldValueSpec): Result<void, DomainError> {
    if (spec.field.type().equals(FieldType.link())) {
      this.linkValues.set(spec.field.id().toString(), null);
    }
    return ok(undefined);
  }

  visit(_spec: ISpecification<unknown, ISpecVisitor>): Result<void, DomainError> {
    return ok(undefined);
  }
}

const buildImpactHint = (
  valueFieldIds: ReadonlyArray<FieldId>,
  linkFieldIds: ReadonlyArray<FieldId>
): UpdateImpactHint => {
  return { valueFieldIds, linkFieldIds };
};

type CollectLinkChangesResult = {
  linkChanges: CollectedLinkChanges;
  exclusivityConstraints: LinkExclusivityConstraint[];
};

const collectLinkChanges = async (params: {
  db: Kysely<DynamicDB>;
  table: Table;
  tableName: string;
  recordId: string;
  mutateSpec: ICellValueSpec;
}): Promise<Result<CollectLinkChangesResult, DomainError>> => {
  const { db, table, tableName, recordId, mutateSpec } = params;

  try {
    const linkValueVisitor = new LinkValueCollectorVisitor();
    const acceptResult = mutateSpec.accept(linkValueVisitor);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const collected = createEmptyCollectedLinkChanges();
    const exclusivityConstraints: LinkExclusivityConstraint[] = [];

    if (linkValueVisitor.values().size === 0) {
      return ok({ linkChanges: collected, exclusivityConstraints });
    }

    for (const [fieldIdStr, newRawValue] of linkValueVisitor.values()) {
      const fieldIdResult = FieldId.create(fieldIdStr);
      if (fieldIdResult.isErr()) return err(fieldIdResult.error);
      const fieldResult = table.getField((candidate) => candidate.id().equals(fieldIdResult.value));
      if (fieldResult.isErr()) return err(fieldResult.error);
      const field = fieldResult.value;
      if (!field.type().equals(FieldType.link())) {
        return err(domainError.validation({ message: 'Field is not a link field' }));
      }

      const linkField = field as LinkField;
      const existingLinksResult = await loadExistingLinkRecordIds(
        db,
        tableName,
        recordId,
        linkField
      );
      if (existingLinksResult.isErr()) return err(existingLinksResult.error);

      // Collect link changes
      const changeVisitor = LinkChangeCollectorVisitor.create({
        recordId,
        existingLinkIds: existingLinksResult.value,
        newRawValue,
      });
      const changeResult = linkField.accept(changeVisitor);
      if (changeResult.isErr()) return err(changeResult.error);
      mergeCollectedLinkChange(collected, changeResult.value, linkField.foreignTableId());

      // Collect exclusivity constraints (for oneOne and oneMany relationships)
      const exclusivityVisitor = LinkExclusivityConstraintCollector.create({
        recordId,
        existingLinkIds: existingLinksResult.value,
        newRawValue,
      });
      const exclusivityResult = linkField.accept(exclusivityVisitor);
      if (exclusivityResult.isErr()) return err(exclusivityResult.error);
      if (exclusivityResult.value.hasConstraint) {
        exclusivityConstraints.push(exclusivityResult.value.constraint);
      }
    }

    return ok({ linkChanges: collected, exclusivityConstraints });
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to collect link changes: ${String(error)}`,
      })
    );
  }
};

const buildExtraSeedRecordsFromLinkChanges = (
  collected: CollectedLinkChanges
): Result<RecordUpdateSeedGroup[], DomainError> => {
  const extraSeedMap = new Map<string, { tableId: TableId; recordIds: Map<string, RecordId> }>();

  for (const group of collected.affectedForeignRecords.values()) {
    if (group.recordIds.length === 0) continue;
    const entry =
      extraSeedMap.get(group.tableId.toString()) ??
      ({
        tableId: group.tableId,
        recordIds: new Map<string, RecordId>(),
      } as const);

    for (const recordId of group.recordIds) {
      entry.recordIds.set(recordId.toString(), recordId);
    }

    extraSeedMap.set(group.tableId.toString(), entry);
  }

  return ok(
    [...extraSeedMap.values()].map((entry) => ({
      tableId: entry.tableId,
      recordIds: [...entry.recordIds.values()],
    }))
  );
};

const RECORD_ID_COLUMN = '__id';

const resolveFkHostTableName = (field: LinkField): Result<string, DomainError> => {
  return field
    .fkHostTableName()
    .split({ defaultSchema: 'public' })
    .map((split) => (split.schema ? `${split.schema}.${split.tableName}` : split.tableName));
};

const loadExistingLinkRecordIds = async (
  db: Kysely<DynamicDB>,
  tableName: string,
  recordId: string,
  field: LinkField
): Promise<Result<string[], DomainError>> => {
  const relationship = field.relationship().toString();

  const orderColumnNameResult = field.hasOrderColumn() ? field.orderColumnName() : ok(null);
  if (orderColumnNameResult.isErr()) return err(orderColumnNameResult.error);
  const orderColumnName = orderColumnNameResult.value;

  const readRows = async (
    targetTable: string,
    columnName: string,
    whereColumn: string,
    orderColumn: string | null
  ) => {
    let query = db
      .selectFrom(targetTable)
      .select(sql.ref(columnName).as('record_id'))
      .where(whereColumn, '=', recordId);
    if (orderColumn) {
      query = query.orderBy(orderColumn, 'asc');
    }
    const rows = await query.execute();

    return rows
      .map((row) => row.record_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
  };

  try {
    if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
      const junctionTableResult = resolveFkHostTableName(field);
      if (junctionTableResult.isErr()) return err(junctionTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);

      const junctionOrderColumn = orderColumnName ?? '__id';
      const rows = await readRows(
        junctionTableResult.value,
        foreignKeyResult.value,
        selfKeyResult.value,
        junctionOrderColumn
      );
      return ok(rows);
    }

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      const foreignKeyResult = field.foreignKeyNameString();
      if (foreignKeyResult.isErr()) return err(foreignKeyResult.error);
      if (foreignKeyResult.value === RECORD_ID_COLUMN) {
        const fkHostTableResult = resolveFkHostTableName(field);
        if (fkHostTableResult.isErr()) return err(fkHostTableResult.error);
        const selfKeyResult = field.selfKeyNameString();
        if (selfKeyResult.isErr()) return err(selfKeyResult.error);
        const orderColumnNameForSymmetric = field.hasOrderColumn()
          ? `${selfKeyResult.value}_order`
          : null;

        const rows = await readRows(
          fkHostTableResult.value,
          RECORD_ID_COLUMN,
          selfKeyResult.value,
          orderColumnNameForSymmetric
        );
        return ok(rows);
      }

      const rows = await db
        .selectFrom(tableName)
        .select(sql.ref(foreignKeyResult.value).as('record_id'))
        .where(RECORD_ID_COLUMN, '=', recordId)
        .executeTakeFirst();

      const value = rows?.record_id;
      if (!value || typeof value !== 'string') return ok([]);
      return ok([value]);
    }

    if (relationship === 'oneMany') {
      const foreignTableResult = resolveFkHostTableName(field);
      if (foreignTableResult.isErr()) return err(foreignTableResult.error);
      const selfKeyResult = field.selfKeyNameString();
      if (selfKeyResult.isErr()) return err(selfKeyResult.error);

      const rows = await readRows(
        foreignTableResult.value,
        RECORD_ID_COLUMN,
        selfKeyResult.value,
        orderColumnName
      );
      return ok(rows);
    }

    return ok([]);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to load existing link records: ${String(error)}`,
      })
    );
  }
};

/**
 * Build linked record locks from collected link changes.
 * These locks prevent deadlocks when multiple transactions update the same foreign records.
 */
const buildLinkedRecordLocksFromLinkChanges = (
  collected: CollectedLinkChanges
): LinkedRecordLockInfo[] => {
  const locks: LinkedRecordLockInfo[] = [];

  for (const linkChange of collected.linkChanges) {
    // Skip if only reordering (no actual relation change needs locks)
    if (linkChange.changeType === 'reorder') {
      continue;
    }

    const foreignTableId = linkChange.symmetricTableId?.toString();
    if (!foreignTableId) continue;

    // Lock all added foreign records
    for (const recordId of linkChange.addedForeignRecordIds) {
      locks.push({
        foreignTableId,
        foreignRecordId: recordId.toString(),
      });
    }

    // Lock all removed foreign records
    for (const recordId of linkChange.removedForeignRecordIds) {
      locks.push({
        foreignTableId,
        foreignRecordId: recordId.toString(),
      });
    }
  }

  return locks;
};
