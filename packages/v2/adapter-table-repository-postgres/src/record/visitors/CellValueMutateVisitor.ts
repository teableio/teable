/* eslint-disable @typescript-eslint/no-this-alias */
import type {
  DomainError,
  Field,
  ICellValueSpecVisitor,
  LinkField,
  SetAttachmentValueSpec,
  SetCheckboxValueSpec,
  SetDateValueSpec,
  SetLinkValueSpec,
  SetLongTextValueSpec,
  SetMultipleSelectValueSpec,
  SetNumberValueSpec,
  SetRatingValueSpec,
  SetSingleLineTextValueSpec,
  SetSingleSelectValueSpec,
  SetUserValueSpec,
  Table,
} from '@teable/v2-core';
import { domainError, FieldId, FieldType, ok } from '@teable/v2-core';
import type { CompiledQuery, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

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

  /**
   * Get the changed field IDs (for computed field propagation).
   */
  getChangedFieldIds(): ReadonlyArray<FieldId> {
    return this.changedFieldIds;
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

  private addSimpleValue(fieldId: FieldId, rawValue: unknown): Result<void, DomainError> {
    const result = this.getFieldAndDbName(fieldId.toString());
    if (result.isErr()) return err(result.error);

    const { field, dbFieldName } = result.value;

    // Skip computed fields
    if (field.computed().toBoolean()) {
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

    // Skip computed fields
    if (field.computed().toBoolean()) {
      return ok(undefined);
    }

    this.changedFieldIds.push(fieldId);
    // JSONB columns need to be stringified for pg driver
    const value = rawValue === null || rawValue === undefined ? null : JSON.stringify(rawValue);
    this.setClauses[dbFieldName] = value;
    return ok(undefined);
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
    return this.addSimpleValue(spec.fieldId, spec.value.toValue());
  }

  visitSetMultipleSelectValue(spec: SetMultipleSelectValueSpec): Result<void, DomainError> {
    return this.addJsonValue(spec.fieldId, spec.value.toValue());
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
      visitor.changedFieldIds.push(fieldId);

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

        // Insert new links
        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const insertValues: Record<string, unknown> = {
            [selfKeyName]: visitor.ctx.recordId,
            [foreignKeyName]: linkItem.id,
          };
          if (orderColumnName) {
            insertValues[orderColumnName] = i + 1;
          }
          const insertQuery = visitor.db
            .insertInto(junctionTableName)
            .values(insertValues)
            .compile();
          visitor.additionalStatements.push(insertQuery);
        }
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        // FK column is on the main table
        const foreignKeyName = yield* linkField.foreignKeyNameString();
        visitor.setClauses[foreignKeyName] = linkItems[0]?.id ?? null;
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

        // Set new links
        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const updateValues: Record<string, unknown> = { [selfKeyName]: visitor.ctx.recordId };
          if (orderColumnName) {
            updateValues[orderColumnName] = i + 1;
          }
          const updateQuery = visitor.db
            .updateTable(foreignTableName)
            .set(updateValues)
            .where('__id', '=', linkItem.id)
            .compile();
          visitor.additionalStatements.push(updateQuery);
        }
      }

      return ok(undefined);
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
