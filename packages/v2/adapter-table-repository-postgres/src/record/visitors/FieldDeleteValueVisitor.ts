import {
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
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

/**
 * Describes a delete cleanup operation for outgoing link references.
 */
export type OutgoingLinkDeleteOp =
  | {
      type: 'junction-delete';
      /** Full table name (schema.table) */
      tableName: string;
      /** Column name for self key */
      selfKeyName: string;
    }
  | {
      type: 'fk-nullify';
      /** Full table name (schema.table) */
      tableName: string;
      /** Column name for self key (FK pointing to deleted records) */
      selfKeyName: string;
      /** Optional order column to nullify */
      orderColumnName: string | null;
    };

/**
 * Result of visiting a field for outgoing link delete cleanup.
 * Contains operation descriptions, NOT executable functions.
 */
export interface FieldDeleteResult {
  /** The delete operation to perform, or null if no operation needed */
  operation: OutgoingLinkDeleteOp | null;
}

interface FieldDeleteContext {
  /** The record IDs being deleted (for reference, not used in operation description) */
  recordIds: ReadonlyArray<string>;
}

/**
 * Visitor that describes delete cleanup operations for each field type.
 *
 * For most fields, this returns no operation.
 * For link fields, this describes the junction table delete or FK nullification needed.
 *
 * This visitor handles the OUTGOING links from the records being deleted.
 * Incoming links (from other tables) are handled by the computed field update mechanism.
 *
 * Usage:
 * 1. Create visitor with context containing record IDs
 * 2. For each field, call field.accept(visitor)
 * 3. If operation is not null, build and execute the SQL based on operation type
 */
export class FieldDeleteValueVisitor implements IFieldVisitor<FieldDeleteResult> {
  private constructor(private readonly _ctx: FieldDeleteContext) {}

  static create(ctx: FieldDeleteContext): FieldDeleteValueVisitor {
    return new FieldDeleteValueVisitor(ctx);
  }

  private noOp(): Result<FieldDeleteResult, DomainError> {
    return ok({ operation: null });
  }

  visitSingleLineTextField(_field: SingleLineTextField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitLongTextField(_field: LongTextField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitNumberField(_field: NumberField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitRatingField(_field: RatingField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitFormulaField(_field: FormulaField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitRollupField(_field: RollupField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitLookupField(_field: LookupField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitSingleSelectField(_field: SingleSelectField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitMultipleSelectField(_field: MultipleSelectField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitCheckboxField(_field: CheckboxField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitDateField(_field: DateField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitAttachmentField(_field: AttachmentField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitUserField(_field: UserField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitCreatedByField(_field: CreatedByField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitAutoNumberField(_field: AutoNumberField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitButtonField(_field: ButtonField): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<FieldDeleteResult, DomainError> {
    return this.noOp();
  }

  /**
   * Describe link field cleanup operation for delete.
   *
   * Returns operation descriptor for:
   * - manyMany/oneMany(oneWay): junction table delete
   * - oneMany(twoWay): FK nullify in foreign table
   * - manyOne/oneOne: no operation (FK is on this table, deleted with record)
   */
  visitLinkField(field: LinkField): Result<FieldDeleteResult, DomainError> {
    return safeTry<FieldDeleteResult, DomainError>(function* () {
      const relationship = field.relationship().toString();

      if (relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay())) {
        // Junction table: delete rows where selfKeyName matches deleted records
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const tableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();

        return ok({
          operation: {
            type: 'junction-delete' as const,
            tableName,
            selfKeyName,
          },
        });
      } else if (relationship === 'oneMany') {
        // FK is on the foreign table: nullify FK pointing to deleted records
        const fkHostTableName = field.fkHostTableName();
        const fkHostTableSplit = yield* fkHostTableName.split({ defaultSchema: 'public' });
        const tableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();
        const orderColumnName = field.hasOrderColumn() ? yield* field.orderColumnName() : null;

        return ok({
          operation: {
            type: 'fk-nullify' as const,
            tableName,
            selfKeyName,
            orderColumnName,
          },
        });
      }
      // For manyOne/oneOne: FK is on the current table, will be deleted with the record

      return ok({ operation: null });
    });
  }
}
