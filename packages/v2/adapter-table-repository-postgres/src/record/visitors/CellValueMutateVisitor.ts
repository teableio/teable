/* eslint-disable @typescript-eslint/no-this-alias */
import type {
  ClearFieldValueSpec,
  DomainError,
  Field,
  ICellValueSpecVisitor,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  MultipleSelectField,
  SetAttachmentValueSpec,
  SetCheckboxValueSpec,
  SetDateValueSpec,
  SetLinkValueByTitleSpec,
  SetLinkValueSpec,
  SetRowOrderValueSpec,
  SetLongTextValueSpec,
  SetMultipleSelectValueSpec,
  SetNumberValueSpec,
  SetRatingValueSpec,
  SetSingleLineTextValueSpec,
  SetSingleSelectValueSpec,
  SingleSelectField,
  SetUserValueSpec,
  SetUserValueByIdentifierSpec,
  Table,
} from '@teable/v2-core';
import {
  CellValue,
  domainError,
  FieldId,
  FieldType,
  ok,
  SetLinkValueSpec as SetLinkValueSpecClass,
} from '@teable/v2-core';
import type { CompiledQuery, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { isPersistedAsGeneratedColumn } from '../computed/isPersistedAsGeneratedColumn';
import type { DynamicDB } from '../query-builder';

// System columns
const RECORD_ID_COLUMN = '__id';
const LAST_MODIFIED_TIME_COLUMN = '__last_modified_time';
const LAST_MODIFIED_BY_COLUMN = '__last_modified_by';
const VERSION_COLUMN = '__version';

/**
 * Result of mutation visitor processing.
 */
export interface MutationStatements {
  /** The main UPDATE statement for the record table */
  mainUpdate: CompiledQuery;
  /** Additional SQL statements (junction table operations, FK updates for link fields) */
  additionalStatements: CompiledQuery[];
  /** Field IDs that were changed (for computed field propagation) */
  changedFieldIds: FieldId[];
}

/**
 * Context for mutation visitor.
 */
export interface CellValueMutateContext {
  recordId: string;
  actorId: string;
  now: string;
  actorName?: string;
  actorEmail?: string;
}

/**
 * Visitor that processes ICellValueSpec and builds UPDATE SQL statements.
 *
 * This visitor:
 * 1. Collects SET clauses for the main record table UPDATE
 * 2. Generates additional SQL for link field operations (junction table, FK updates)
 * 3. Handles value conversion to database format (JSONB serialization, etc.)
 *
 * Usage:
 * ```typescript
 * const visitor = CellValueMutateVisitor.create(db, table, tableName, context);
 * const acceptResult = mutateSpec.accept(visitor);
 * if (acceptResult.isErr()) return err(acceptResult.error);
 * const statements = visitor.build();
 * ```
 */
export class CellValueMutateVisitor implements ICellValueSpecVisitor {
  private readonly setClauses: Record<string, unknown> = {};
  private readonly additionalStatements: CompiledQuery[] = [];
  private readonly changedFieldIds: FieldId[] = [];

  private constructor(
    private readonly db: Kysely<DynamicDB>,
    private readonly table: Table,
    private readonly tableName: string,
    private readonly ctx: CellValueMutateContext
  ) {
    // Initialize system columns
    this.setClauses[LAST_MODIFIED_TIME_COLUMN] = this.ctx.now;
    this.setClauses[LAST_MODIFIED_BY_COLUMN] = this.ctx.actorId;
    this.setClauses[VERSION_COLUMN] = sql`${sql.ref(VERSION_COLUMN)} + 1`;
  }

  static create(
    db: Kysely<DynamicDB>,
    table: Table,
    tableName: string,
    ctx: CellValueMutateContext
  ): CellValueMutateVisitor {
    return new CellValueMutateVisitor(db, table, tableName, ctx);
  }

  /**
   * Build the final mutation statements.
   */
  build(): Result<MutationStatements, DomainError> {
    const lastModifiedTimeResult = this.applyTrackedLastModifiedTimeUpdates();
    if (lastModifiedTimeResult.isErr()) return err(lastModifiedTimeResult.error);

    const lastModifiedByResult = this.applyTrackedLastModifiedByUpdates();
    if (lastModifiedByResult.isErr()) return err(lastModifiedByResult.error);

    const mainUpdate = this.db
      .updateTable(this.tableName)
      .set(this.setClauses)
      .where(RECORD_ID_COLUMN, '=', this.ctx.recordId)
      .compile();

    return ok({
      mainUpdate,
      additionalStatements: this.additionalStatements,
      changedFieldIds: this.changedFieldIds,
    });
  }

  private applyTrackedLastModifiedTimeUpdates(): Result<void, DomainError> {
    const visitor = this;
    return safeTry<void, DomainError>(function* () {
      if (visitor.changedFieldIds.length === 0) return ok(undefined);

      const lastModifiedTimeFields = visitor.table.getFields(
        (field): field is LastModifiedTimeField => field.type().equals(FieldType.lastModifiedTime())
      );

      for (const field of lastModifiedTimeFields) {
        const trackedFieldIds = yield* visitor.resolveTrackedFieldIds(field);
        const shouldUpdate =
          trackedFieldIds.length === 0 ||
          trackedFieldIds.some((tracked) =>
            visitor.changedFieldIds.some((changed) => changed.equals(tracked))
          );
        if (!shouldUpdate) continue;

        const isGenerated = yield* isPersistedAsGeneratedColumn(field);
        if (!isGenerated) {
          const dbFieldName = yield* visitor.resolveDbFieldName(field);
          visitor.setClauses[dbFieldName] = visitor.ctx.now;
        }

        if (!visitor.changedFieldIds.some((changed) => changed.equals(field.id()))) {
          visitor.changedFieldIds.push(field.id());
        }
      }

      return ok(undefined);
    });
  }

  private applyTrackedLastModifiedByUpdates(): Result<void, DomainError> {
    const visitor = this;
    return safeTry<void, DomainError>(function* () {
      if (visitor.changedFieldIds.length === 0) return ok(undefined);

      const lastModifiedByFields = visitor.table.getFields((field): field is LastModifiedByField =>
        field.type().equals(FieldType.lastModifiedBy())
      );

      for (const field of lastModifiedByFields) {
        const trackedFieldIds = yield* visitor.resolveTrackedFieldIds(field);
        const shouldUpdate =
          trackedFieldIds.length === 0 ||
          trackedFieldIds.some((tracked) =>
            visitor.changedFieldIds.some((changed) => changed.equals(tracked))
          );
        if (!shouldUpdate) continue;

        const isGenerated = yield* isPersistedAsGeneratedColumn(field);
        if (!isGenerated) {
          const dbFieldName = yield* visitor.resolveDbFieldName(field);
          visitor.setClauses[dbFieldName] = visitor.buildLastModifiedByValue();
        }

        if (!visitor.changedFieldIds.some((changed) => changed.equals(field.id()))) {
          visitor.changedFieldIds.push(field.id());
        }
      }

      return ok(undefined);
    });
  }

  private resolveDbFieldName(field: Field): Result<string, DomainError> {
    return safeTry<string, DomainError>(function* () {
      const dbFieldName = yield* field.dbFieldName();
      const dbFieldNameValue = yield* dbFieldName.value();
      return ok(dbFieldNameValue);
    });
  }

  /**
   * Get the changed field IDs (for computed field propagation).
   */
  getChangedFieldIds(): ReadonlyArray<FieldId> {
    return this.changedFieldIds;
  }

  /**
   * Get the raw SET clause values for batch operations.
   * Returns a copy of the SET clauses, additional statements, and changed field IDs.
   *
   * This is used by BatchRecordUpdateBuilder to collect update values
   * across multiple records before generating batch UPDATE SQL.
   *
   * Note: This should be called after build() has been called, as build()
   * applies tracked field updates (LastModifiedTime, LastModifiedBy) to setClauses.
   */
  getSetClausesRaw(): {
    setClauses: Record<string, unknown>;
    additionalStatements: CompiledQuery[];
    changedFieldIds: FieldId[];
  } {
    // Return a shallow copy to prevent external modifications
    return {
      setClauses: { ...this.setClauses },
      additionalStatements: [...this.additionalStatements],
      changedFieldIds: [...this.changedFieldIds],
    };
  }

  // --- Helper methods ---

  private getFieldAndDbName(
    fieldIdStr: string
  ): Result<{ field: Field; dbFieldName: string }, DomainError> {
    const fieldIdResult = FieldId.create(fieldIdStr);
    if (fieldIdResult.isErr()) {
      return err(fieldIdResult.error);
    }
    const fieldId = fieldIdResult.value;

    const fieldResult = this.table.getField((candidate: Field) => candidate.id().equals(fieldId));
    if (fieldResult.isErr()) {
      return err(fieldResult.error);
    }
    const field = fieldResult.value;

    const dbFieldNameResult = field.dbFieldName();
    if (dbFieldNameResult.isErr()) {
      return err(dbFieldNameResult.error);
    }
    const dbFieldNameValueResult = dbFieldNameResult.value.value();
    if (dbFieldNameValueResult.isErr()) {
      return err(dbFieldNameValueResult.error);
    }

    return ok({ field, dbFieldName: dbFieldNameValueResult.value });
  }

  private shouldSkipComputed(field: Field): Result<boolean, DomainError> {
    if (!field.computed().toBoolean()) {
      return ok(false);
    }

    const isSystemComputed =
      field.type().equals(FieldType.createdTime()) ||
      field.type().equals(FieldType.lastModifiedTime()) ||
      field.type().equals(FieldType.createdBy()) ||
      field.type().equals(FieldType.lastModifiedBy()) ||
      field.type().equals(FieldType.autoNumber());

    if (!isSystemComputed) {
      return ok(true);
    }

    return isPersistedAsGeneratedColumn(field);
  }

  private resolveTrackedFieldIds(
    field: LastModifiedByField | LastModifiedTimeField
  ): Result<ReadonlyArray<FieldId>, DomainError> {
    const visitor = this;
    const trackedFieldIds = field.trackedFieldIds();
    if (trackedFieldIds.length === 0) {
      return ok([]);
    }

    const validTracked = trackedFieldIds.filter((tracked) => {
      const result = visitor.table.getField((candidate) => candidate.id().equals(tracked));
      return result.isOk();
    });

    if (validTracked.length === 0) {
      return ok([]);
    }

    return ok(validTracked);
  }

  /**
   * Build the value for LastModifiedBy field using COALESCE subquery.
   * Fetches user info from users table, with fallback to just the actor ID.
   */
  private buildLastModifiedByValue(): ReturnType<typeof sql> {
    const avatarPrefix = '/api/attachments/read/public/avatar/';
    return sql`COALESCE(
      (
        SELECT jsonb_build_object(
          'id', u.id,
          'title', u.name,
          'email', u.email,
          'avatarUrl', ${avatarPrefix} || u.id
        )
        FROM public.users u
        WHERE u.id = ${this.ctx.actorId}::text
      ),
      jsonb_build_object(
        'id', ${this.ctx.actorId}::text,
        'title', ${this.ctx.actorId}::text,
        'email', NULL::text,
        'avatarUrl', ${avatarPrefix}::text || ${this.ctx.actorId}::text
      )
    )`;
  }

  private addSimpleValue(fieldId: FieldId, rawValue: unknown): Result<void, DomainError> {
    const result = this.getFieldAndDbName(fieldId.toString());
    if (result.isErr()) return err(result.error);

    const { field, dbFieldName } = result.value;

    const skipResult = this.shouldSkipComputed(field);
    if (skipResult.isErr()) return err(skipResult.error);
    if (skipResult.value) {
      return ok(undefined);
    }

    this.changedFieldIds.push(fieldId);
    this.setClauses[dbFieldName] = rawValue ?? null;
    return ok(undefined);
  }

  private addJsonValue(fieldId: FieldId, rawValue: unknown): Result<void, DomainError> {
    const result = this.getFieldAndDbName(fieldId.toString());
    if (result.isErr()) return err(result.error);

    const { field, dbFieldName } = result.value;

    const skipResult = this.shouldSkipComputed(field);
    if (skipResult.isErr()) return err(skipResult.error);
    if (skipResult.value) {
      return ok(undefined);
    }

    this.changedFieldIds.push(fieldId);
    // JSONB columns need to be stringified for pg driver
    const value = rawValue === null || rawValue === undefined ? null : JSON.stringify(rawValue);
    this.setClauses[dbFieldName] = value;
    return ok(undefined);
  }

  private mapSingleSelectValue(field: SingleSelectField, rawValue: unknown): unknown {
    if (rawValue === null || rawValue === undefined) {
      return null;
    }
    if (typeof rawValue !== 'string') {
      return rawValue;
    }

    const options = field.selectOptions();
    const byId = options.find((opt) => opt.id().toString() === rawValue);
    if (byId) {
      return byId.name().toString();
    }

    const byName = options.find((opt) => opt.name().toString() === rawValue);
    if (byName) {
      return byName.name().toString();
    }

    return rawValue;
  }

  private mapMultipleSelectValue(field: MultipleSelectField, rawValue: unknown): unknown {
    if (rawValue === null || rawValue === undefined) {
      return null;
    }
    if (!Array.isArray(rawValue)) {
      return rawValue;
    }

    const options = field.selectOptions();
    const nameById = new Map(options.map((opt) => [opt.id().toString(), opt.name().toString()]));
    const validNames = new Set(options.map((opt) => opt.name().toString()));

    return rawValue.map((item) => {
      if (typeof item !== 'string') {
        return item;
      }
      const name = nameById.get(item);
      if (name) {
        return name;
      }
      if (validNames.has(item)) {
        return item;
      }
      return item;
    });
  }

  private addSelectValue(
    fieldId: FieldId,
    rawValue: unknown,
    kind: 'single' | 'multiple'
  ): Result<void, DomainError> {
    const result = this.getFieldAndDbName(fieldId.toString());
    if (result.isErr()) return err(result.error);

    const { field, dbFieldName } = result.value;

    // Skip computed fields
    if (field.computed().toBoolean()) {
      return ok(undefined);
    }

    if (kind === 'single' && field.type().equals(FieldType.singleSelect())) {
      const mappedValue = this.mapSingleSelectValue(field as SingleSelectField, rawValue);
      this.changedFieldIds.push(fieldId);
      this.setClauses[dbFieldName] = mappedValue ?? null;
      return ok(undefined);
    }

    if (kind === 'multiple' && field.type().equals(FieldType.multipleSelect())) {
      const mappedValue = this.mapMultipleSelectValue(field as MultipleSelectField, rawValue);
      this.changedFieldIds.push(fieldId);
      const value =
        mappedValue === null || mappedValue === undefined ? null : JSON.stringify(mappedValue);
      this.setClauses[dbFieldName] = value;
      return ok(undefined);
    }

    return kind === 'single'
      ? this.addSimpleValue(fieldId, rawValue)
      : this.addJsonValue(fieldId, rawValue);
  }

  // --- Text types ---

  visitSetSingleLineTextValue(spec: SetSingleLineTextValueSpec): Result<void, DomainError> {
    return this.addSimpleValue(spec.fieldId, spec.value.toValue());
  }

  visitSetLongTextValue(spec: SetLongTextValueSpec): Result<void, DomainError> {
    return this.addSimpleValue(spec.fieldId, spec.value.toValue());
  }

  // --- Numeric types ---

  visitSetNumberValue(spec: SetNumberValueSpec): Result<void, DomainError> {
    return this.addSimpleValue(spec.fieldId, spec.value.toValue());
  }

  visitSetRatingValue(spec: SetRatingValueSpec): Result<void, DomainError> {
    return this.addSimpleValue(spec.fieldId, spec.value.toValue());
  }

  // --- Select types ---

  visitSetSingleSelectValue(spec: SetSingleSelectValueSpec): Result<void, DomainError> {
    return this.addSelectValue(spec.fieldId, spec.value.toValue(), 'single');
  }

  visitSetMultipleSelectValue(spec: SetMultipleSelectValueSpec): Result<void, DomainError> {
    return this.addSelectValue(spec.fieldId, spec.value.toValue(), 'multiple');
  }

  // --- Other types ---

  visitSetCheckboxValue(spec: SetCheckboxValueSpec): Result<void, DomainError> {
    return this.addSimpleValue(spec.fieldId, spec.value.toValue());
  }

  visitSetDateValue(spec: SetDateValueSpec): Result<void, DomainError> {
    return this.addSimpleValue(spec.fieldId, spec.value.toValue());
  }

  visitSetAttachmentValue(spec: SetAttachmentValueSpec): Result<void, DomainError> {
    return this.addJsonValue(spec.fieldId, spec.value.toValue());
  }

  visitSetUserValue(spec: SetUserValueSpec): Result<void, DomainError> {
    return this.addJsonValue(spec.fieldId, spec.value.toValue());
  }

  visitSetUserValueByIdentifier(_spec: SetUserValueByIdentifierSpec): Result<void, DomainError> {
    return err(
      domainError.validation({
        code: 'validation.field.user_requires_resolution',
        message: 'User identifiers must be resolved before persistence',
      })
    );
  }

  visitSetRowOrderValue(spec: SetRowOrderValueSpec): Result<void, DomainError> {
    const orderColumnName = spec.viewId.toRowOrderColumnName();
    this.setClauses[orderColumnName] = spec.orderValue;
    return ok(undefined);
  }

  // --- Clear field (set to null) ---

  visitClearFieldValue(spec: ClearFieldValueSpec): Result<void, DomainError> {
    const field = spec.field;

    if (field.type().equals(FieldType.link())) {
      // Link fields need junction table cleanup — delegate to existing link handling
      const nullSpec = new SetLinkValueSpecClass(field.id(), CellValue.null());
      return this.visitSetLinkValue(nullSpec);
    }

    // Non-link fields: directly SET col = NULL
    return this.addSimpleValue(field.id(), null);
  }

  // --- Link field ---

  visitSetLinkValue(spec: SetLinkValueSpec): Result<void, DomainError> {
    const visitor = this;

    return safeTry<void, DomainError>(function* () {
      const fieldIdStr = spec.fieldId.toString();
      const rawValue = spec.value.toValue();

      const fieldIdResult = FieldId.create(fieldIdStr);
      if (fieldIdResult.isErr()) return err(fieldIdResult.error);
      const fieldId = fieldIdResult.value;

      const fieldResult = visitor.table.getField((candidate) => candidate.id().equals(fieldId));
      if (fieldResult.isErr()) return err(fieldResult.error);
      const field = fieldResult.value;

      if (!field.type().equals(FieldType.link())) {
        return err(domainError.validation({ message: 'Field is not a link field' }));
      }

      const linkField = field as LinkField;

      const storedValue = linkField.isMultipleValue()
        ? rawValue
        : Array.isArray(rawValue)
          ? rawValue[0] ?? null
          : rawValue;
      const jsonResult = visitor.addJsonValue(fieldId, storedValue);
      if (jsonResult.isErr()) {
        return err(jsonResult.error);
      }

      // Parse link items
      const linkItems: Array<{ id: string }> = [];
      if (rawValue !== null && rawValue !== undefined) {
        const items = Array.isArray(rawValue)
          ? (rawValue as Array<{ id: string }>)
          : [rawValue as { id: string }];
        linkItems.push(...items.filter((item) => item && typeof item === 'object' && 'id' in item));
      }

      const relationship = linkField.relationship().toString();
      const hasOrderColumn = linkField.hasOrderColumn();
      const orderColumnName = hasOrderColumn ? yield* linkField.orderColumnName() : null;

      if (relationship === 'manyMany' || (relationship === 'oneMany' && linkField.isOneWay())) {
        // Junction table: delete existing + insert new
        const fkHostTableName = linkField.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const junctionTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* linkField.selfKeyNameString();
        const foreignKeyName = yield* linkField.foreignKeyNameString();

        // Delete all existing links for this record
        const deleteQuery = visitor.db
          .deleteFrom(junctionTableName)
          .where(selfKeyName, '=', visitor.ctx.recordId)
          .compile();
        visitor.additionalStatements.push(deleteQuery);

        if (linkItems.length > 0) {
          const insertValues = linkItems.map((linkItem, index) => {
            const values: Record<string, unknown> = {
              [selfKeyName]: visitor.ctx.recordId,
              [foreignKeyName]: linkItem.id,
            };
            if (orderColumnName) {
              values[orderColumnName] = index + 1;
            }
            return values;
          });

          const insertQuery = visitor.db
            .insertInto(junctionTableName)
            .values(insertValues)
            .compile();
          visitor.additionalStatements.push(insertQuery);
        }
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        const foreignKeyName = yield* linkField.foreignKeyNameString();

        if (foreignKeyName === RECORD_ID_COLUMN) {
          // Symmetric link fields store the FK on the opposite table. Avoid updating __id.
          const fkHostTableName = linkField.fkHostTableName();
          const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
          const foreignTableName = fkHostTableSplit.schema
            ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
            : fkHostTableSplit.tableName;
          const selfKeyName = yield* linkField.selfKeyNameString();
          const orderColumnNameForSymmetric = linkField.hasOrderColumn()
            ? `${selfKeyName}_order`
            : null;

          const clearValues: Record<string, unknown> = { [selfKeyName]: null };
          if (orderColumnNameForSymmetric) {
            clearValues[orderColumnNameForSymmetric] = null;
          }
          const clearQuery = visitor.db
            .updateTable(foreignTableName)
            .set(clearValues)
            .where(selfKeyName, '=', visitor.ctx.recordId)
            .compile();
          visitor.additionalStatements.push(clearQuery);

          if (linkItems.length > 0) {
            const orderColumnAlias = 'order_index';
            const valuesSql = sql.join(
              linkItems.map((linkItem, index) => {
                if (orderColumnNameForSymmetric) {
                  return sql`(${sql.value(linkItem.id)}, ${sql.value(
                    visitor.ctx.recordId
                  )}, ${sql.value(index + 1)})`;
                }
                return sql`(${sql.value(linkItem.id)}, ${sql.value(visitor.ctx.recordId)})`;
              }),
              sql`, `
            );

            const valuesTable = orderColumnNameForSymmetric
              ? sql`(values ${valuesSql}) as v(id, record_id, ${sql.raw(orderColumnAlias)})`
              : sql`(values ${valuesSql}) as v(id, record_id)`;

            const updateSql = orderColumnNameForSymmetric
              ? sql`update ${sql.table(foreignTableName)} as t set ${sql.ref(
                  selfKeyName
                )} = ${sql.ref('v.record_id')}, ${sql.ref(
                  orderColumnNameForSymmetric
                )} = ${sql`${sql.ref(`v.${orderColumnAlias}`)}::integer`} from ${valuesTable} where ${sql.ref(
                  't.__id'
                )} = ${sql.ref('v.id')}`
              : sql`update ${sql.table(foreignTableName)} as t set ${sql.ref(
                  selfKeyName
                )} = ${sql.ref('v.record_id')} from ${valuesTable} where ${sql.ref(
                  't.__id'
                )} = ${sql.ref('v.id')}`;

            visitor.additionalStatements.push(updateSql.compile(visitor.db));
          }
        } else {
          // FK column is on the main table
          visitor.setClauses[foreignKeyName] = linkItems[0]?.id ?? null;
        }
      } else if (relationship === 'oneMany') {
        // oneMany (two-way): FK is on the foreign table
        const fkHostTableName = linkField.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const foreignTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* linkField.selfKeyNameString();

        // Clear previous links
        const clearValues: Record<string, unknown> = { [selfKeyName]: null };
        if (orderColumnName) {
          clearValues[orderColumnName] = null;
        }
        const clearQuery = visitor.db
          .updateTable(foreignTableName)
          .set(clearValues)
          .where(selfKeyName, '=', visitor.ctx.recordId)
          .compile();
        visitor.additionalStatements.push(clearQuery);

        if (linkItems.length > 0) {
          const orderColumnAlias = 'order_index';
          const valuesSql = sql.join(
            linkItems.map((linkItem, index) => {
              if (orderColumnName) {
                return sql`(${sql.value(linkItem.id)}, ${sql.value(visitor.ctx.recordId)}, ${sql.value(
                  index + 1
                )})`;
              }
              return sql`(${sql.value(linkItem.id)}, ${sql.value(visitor.ctx.recordId)})`;
            }),
            sql`, `
          );

          const valuesTable = orderColumnName
            ? sql`(values ${valuesSql}) as v(id, record_id, ${sql.raw(orderColumnAlias)})`
            : sql`(values ${valuesSql}) as v(id, record_id)`;

          const updateSql = orderColumnName
            ? sql`update ${sql.table(foreignTableName)} as t set ${sql.ref(
                selfKeyName
              )} = ${sql.ref('v.record_id')}, ${sql.ref(
                orderColumnName
              )} = ${sql`${sql.ref(`v.${orderColumnAlias}`)}::integer`} from ${valuesTable} where ${sql.ref(
                't.__id'
              )} = ${sql.ref('v.id')}`
            : sql`update ${sql.table(foreignTableName)} as t set ${sql.ref(
                selfKeyName
              )} = ${sql.ref('v.record_id')} from ${valuesTable} where ${sql.ref(
                't.__id'
              )} = ${sql.ref('v.id')}`;

          visitor.additionalStatements.push(updateSql.compile(visitor.db));
        }
      }

      return ok(undefined);
    });
  }

  // --- Link field by title (typecast mode) ---

  /**
   * Handle SetLinkValueByTitleSpec - used when typecast mode provides titles instead of IDs.
   *
   * This implementation requires pre-loaded foreign table information because PostgreSQL
   * doesn't support dynamic table references in standard SQL. The foreign table's db_table_name
   * and the lookup field's db_field_name must be available either:
   * 1. From the table's baseId (assuming db_table_name follows the pattern: baseId.tableId)
   * 2. From pre-loaded foreign tables passed to the visitor
   *
   * For now, this implementation returns an error indicating that titles should be
   * pre-resolved to IDs in the handler layer before calling the repository.
   * The recommended approach is to use a dedicated title-to-ID resolution service.
   */
  visitSetLinkValueByTitle(spec: SetLinkValueByTitleSpec): Result<void, DomainError> {
    const visitor = this;

    return safeTry<void, DomainError>(function* () {
      const fieldIdStr = spec.fieldId.toString();
      const titles = spec.titles;

      const fieldIdResult = FieldId.create(fieldIdStr);
      if (fieldIdResult.isErr()) return err(fieldIdResult.error);
      const fieldId = fieldIdResult.value;

      const fieldResult = visitor.table.getField((candidate) => candidate.id().equals(fieldId));
      if (fieldResult.isErr()) return err(fieldResult.error);
      const field = fieldResult.value;

      if (!field.type().equals(FieldType.link())) {
        return err(domainError.validation({ message: 'Field is not a link field' }));
      }

      const linkField = field as LinkField;
      visitor.changedFieldIds.push(fieldId);

      // If titles is empty, treat as clearing the link
      if (titles.length === 0) {
        // Handle like SetLinkValue with empty value
        const relationship = linkField.relationship().toString();
        const hasOrderColumn = linkField.hasOrderColumn();
        const orderColumnName = hasOrderColumn ? yield* linkField.orderColumnName() : null;

        if (relationship === 'manyMany' || (relationship === 'oneMany' && linkField.isOneWay())) {
          const fkHostTableName = linkField.fkHostTableName();
          const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
          const junctionTableName = fkHostTableSplit.schema
            ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
            : fkHostTableSplit.tableName;
          const selfKeyName = yield* linkField.selfKeyNameString();

          const deleteQuery = visitor.db
            .deleteFrom(junctionTableName)
            .where(selfKeyName, '=', visitor.ctx.recordId)
            .compile();
          visitor.additionalStatements.push(deleteQuery);
        } else if (relationship === 'manyOne' || relationship === 'oneOne') {
          const foreignKeyName = yield* linkField.foreignKeyNameString();
          visitor.setClauses[foreignKeyName] = null;
        } else if (relationship === 'oneMany') {
          const fkHostTableName = linkField.fkHostTableName();
          const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
          const foreignTableName = fkHostTableSplit.schema
            ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
            : fkHostTableSplit.tableName;
          const selfKeyName = yield* linkField.selfKeyNameString();

          const clearValues: Record<string, unknown> = { [selfKeyName]: null };
          if (orderColumnName) {
            clearValues[orderColumnName] = null;
          }
          const clearQuery = visitor.db
            .updateTable(foreignTableName)
            .set(clearValues)
            .where(selfKeyName, '=', visitor.ctx.recordId)
            .compile();
          visitor.additionalStatements.push(clearQuery);
        }

        return ok(undefined);
      }

      // For non-empty titles, we need async resolution which is not supported
      // in this synchronous visitor. The handler should pre-resolve titles to IDs.
      //
      // TODO: Implement async title resolution in a higher layer:
      // 1. Handler receives typecast=true with title values
      // 2. Handler queries foreign table to resolve titles to record IDs
      // 3. Handler converts SetLinkValueByTitleSpec to SetLinkValueSpec with resolved IDs
      // 4. Repository receives SetLinkValueSpec and processes normally
      //
      // Alternative: Create an AsyncCellValueMutateVisitor that supports async operations

      return err(
        domainError.validation({
          code: 'validation.link.title_resolution_required',
          message:
            'SetLinkValueByTitle requires title-to-ID resolution before repository processing. ' +
            'The handler layer should resolve link titles to record IDs using a dedicated query, ' +
            'then convert to SetLinkValueSpec. This ensures proper error handling and validation.',
          details: {
            fieldId: fieldIdStr,
            foreignTableId: spec.foreignTableId.toString(),
            titlesCount: titles.length,
          },
        })
      );
    });
  }

  // --- ISpecVisitor required methods ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(_spec: any): Result<void, DomainError> {
    // AndSpec.accept calls v.visit(this), then handles left/right itself.
    // We just return ok here to avoid infinite recursion.
    return ok(undefined);
  }

  and(): Result<void, DomainError> {
    // AndSpec calls this after visit - just continue
    return ok(undefined);
  }

  or(): Result<void, DomainError> {
    return err(
      domainError.validation({
        message: 'OrSpec is not supported in CellValueMutateVisitor',
      })
    );
  }

  not(): Result<void, DomainError> {
    return err(
      domainError.validation({
        message: 'NotSpec is not supported in CellValueMutateVisitor',
      })
    );
  }
}
