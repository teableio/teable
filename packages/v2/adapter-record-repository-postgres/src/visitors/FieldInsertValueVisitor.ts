import {
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DomainError,
  type FormulaField,
  type IFieldVisitor,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
  ok,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { safeTry } from 'neverthrow';
import type { Kysely } from 'kysely';

import type { DynamicDB } from '../query-builder';

/**
 * A function that builds and executes a query when given a database instance.
 *
 * This type represents deferred query execution - the function captures the
 * query logic but delays execution until a database instance is provided.
 * Used for operations that need to run after the main insert (e.g., junction
 * table inserts for many-to-many relationships).
 *
 * @template DB - Database schema type, defaults to {@link DynamicDB}
 * @see {@link DynamicDB} - The canonical database schema type for this package
 */
export type QueryExecutor<DB = DynamicDB> = (db: Kysely<DB>) => Promise<unknown>;

/**
 * Result of visiting a field for insert operation.
 * Contains column values to insert into the main table and
 * any additional query executors to run after the main insert.
 *
 * @template DB - Database schema type, defaults to {@link DynamicDB}
 */
export interface FieldInsertResult<DB = DynamicDB> {
  /** Column values to add to the main table INSERT statement */
  columnValues: Record<string, unknown>;
  /** Query executors to run (junction inserts, FK updates, etc.) */
  queryExecutors: QueryExecutor<DB>[];
}

interface FieldInsertContext {
  /** The record ID being inserted */
  recordId: string;
  /** The database column name for this field's value */
  dbFieldName: string;
}

/**
 * Visitor that generates insert values and statements for each field type.
 *
 * For most fields, this simply maps the value to the appropriate column.
 * For link fields, this handles the FK columns and junction table inserts.
 */
export class FieldInsertValueVisitor implements IFieldVisitor<FieldInsertResult> {
  private constructor(
    private readonly rawValue: unknown,
    private readonly ctx: FieldInsertContext
  ) {}

  static create(rawValue: unknown, ctx: FieldInsertContext): FieldInsertValueVisitor {
    return new FieldInsertValueVisitor(rawValue, ctx);
  }

  private simpleValue(): Result<FieldInsertResult, DomainError> {
    return ok({
      columnValues: { [this.ctx.dbFieldName]: this.rawValue ?? null },
      queryExecutors: [],
    });
  }

  private jsonValue(): Result<FieldInsertResult, DomainError> {
    // JSONB columns - must JSON.stringify for pg driver
    const value =
      this.rawValue === null || this.rawValue === undefined ? null : JSON.stringify(this.rawValue);
    return ok({
      columnValues: { [this.ctx.dbFieldName]: value },
      queryExecutors: [],
    });
  }

  private computedField(): Result<FieldInsertResult, DomainError> {
    // Computed fields don't get values inserted
    return ok({
      columnValues: {},
      queryExecutors: [],
    });
  }

  visitSingleLineTextField(_field: SingleLineTextField): Result<FieldInsertResult, DomainError> {
    return this.simpleValue();
  }

  visitLongTextField(_field: LongTextField): Result<FieldInsertResult, DomainError> {
    return this.simpleValue();
  }

  visitNumberField(_field: NumberField): Result<FieldInsertResult, DomainError> {
    return this.simpleValue();
  }

  visitRatingField(_field: RatingField): Result<FieldInsertResult, DomainError> {
    return this.simpleValue();
  }

  visitFormulaField(_field: FormulaField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitRollupField(_field: RollupField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitLookupField(_field: LookupField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitSingleSelectField(_field: SingleSelectField): Result<FieldInsertResult, DomainError> {
    return this.simpleValue();
  }

  visitMultipleSelectField(_field: MultipleSelectField): Result<FieldInsertResult, DomainError> {
    return this.jsonValue();
  }

  visitCheckboxField(_field: CheckboxField): Result<FieldInsertResult, DomainError> {
    return this.simpleValue();
  }

  visitDateField(_field: DateField): Result<FieldInsertResult, DomainError> {
    return this.simpleValue();
  }

  visitAttachmentField(_field: AttachmentField): Result<FieldInsertResult, DomainError> {
    return this.jsonValue();
  }

  visitUserField(_field: UserField): Result<FieldInsertResult, DomainError> {
    return this.jsonValue();
  }

  visitLinkField(field: LinkField): Result<FieldInsertResult, DomainError> {
    const visitor = this;
    return safeTry<FieldInsertResult, DomainError>(function* () {
      const columnValues: Record<string, unknown> = {};
      const queryExecutors: QueryExecutor[] = [];

      // Note: Link value JSONB column is not stored during insert.
      // It will be computed/populated later. For now, we only handle FK relationships.

      // If no value, nothing to do
      if (visitor.rawValue === null || visitor.rawValue === undefined) {
        return ok({ columnValues, queryExecutors });
      }

      // Parse link items
      const linkItems = Array.isArray(visitor.rawValue)
        ? (visitor.rawValue as Array<{ id: string; title?: string }>)
        : [visitor.rawValue as { id: string; title?: string }];

      if (linkItems.length === 0) {
        return ok({ columnValues, queryExecutors });
      }

      const relationship = field.relationship().toString();

      if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
        // Junction table: insert rows for each linked record
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const tableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();
        const orderColumnName = yield* field.orderColumnName();

        for (let i = 0; i < linkItems.length; i++) {
          const linkItem = linkItems[i];
          const order = i + 1;

          // Capture values for closure
          const recordId = visitor.ctx.recordId;
          const foreignRecordId = linkItem.id;
          const insertValues = {
            [selfKeyName]: recordId,
            [foreignKeyName]: foreignRecordId,
            [orderColumnName]: order,
          };

          // Strategy: DELETE existing link then INSERT new one
          // This is more robust than ON CONFLICT which requires a unique constraint
          // that may not exist on legacy tables
          queryExecutors.push(async (db) => {
            // Delete any existing link between these two records
            await db
              .deleteFrom(tableName)
              .where(selfKeyName, '=', recordId)
              .where(foreignKeyName, '=', foreignRecordId)
              .execute();

            // Insert the new link with updated order
            await db.insertInto(tableName).values(insertValues).execute();
          });
        }
      } else if (relationship === 'manyOne' || relationship === 'oneOne') {
        // FK column in main table: set the foreign key value
        // For manyOne/oneOne, we only link to one record (first item)
        const foreignKeyName = yield* field.foreignKeyNameString();
        const firstLinkItem = linkItems[0];
        columnValues[foreignKeyName] = firstLinkItem.id;
      } else if (relationship === 'oneMany') {
        // oneMany (two-way): FK is on the foreign table
        // We need to UPDATE the foreign records to point their FK to the current record
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const tableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        // selfKeyName is the FK column in the foreign table that points to current table
        const selfKeyName = yield* field.selfKeyNameString();

        for (const linkItem of linkItems) {
          // Capture values for closure
          const recordId = visitor.ctx.recordId;
          const linkedRecordId = linkItem.id;

          queryExecutors.push((db) =>
            db
              .updateTable(tableName)
              .set({ [selfKeyName]: recordId })
              .where('__id', '=', linkedRecordId)
              .execute()
          );
        }
      }

      return ok({ columnValues, queryExecutors });
    });
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitCreatedByField(_field: CreatedByField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitAutoNumberField(_field: AutoNumberField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }

  visitButtonField(_field: ButtonField): Result<FieldInsertResult, DomainError> {
    return this.computedField();
  }
}
