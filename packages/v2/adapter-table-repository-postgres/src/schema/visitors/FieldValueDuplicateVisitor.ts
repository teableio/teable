import {
  AbstractFieldVisitor,
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
  type Field,
  FieldType,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { CompiledQuery, Kysely } from 'kysely';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { LinkFieldValueDuplicateVisitor } from './LinkFieldValueDuplicateVisitor';

type FieldValueDuplicateVisitorContext = {
  schema: string | null;
  tableName: string;
  sourceDbFieldName: string;
  targetDbFieldName: string;
  newField?: Field;
};

/**
 * Visitor that generates SQL statements for duplicating field values.
 *
 * Core principle: Push duplication to SQL layer (UPDATE SET new = old)
 * rather than JS-layer query-then-update.
 *
 * SQL strategies by field type:
 * - Simple fields: UPDATE table SET new_col = old_col
 * - Computed fields (formula, rollup, etc.): Skip (values auto-recalculate)
 * - Link fields: Copy value column + duplicate relationship storage (junction/FK)
 */
export class FieldValueDuplicateVisitor extends AbstractFieldVisitor<ReadonlyArray<CompiledQuery>> {
  private constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private readonly ctx: FieldValueDuplicateVisitorContext
  ) {
    super();
  }

  static create(
    db: Kysely<V1TeableDatabase>,
    ctx: FieldValueDuplicateVisitorContext
  ): FieldValueDuplicateVisitor {
    return new FieldValueDuplicateVisitor(db, ctx);
  }

  private get fullTableName(): string {
    return this.ctx.schema
      ? `"${this.ctx.schema}"."${this.ctx.tableName}"`
      : `"${this.ctx.tableName}"`;
  }

  /**
   * Generates a simple UPDATE SET new = old statement.
   * Used for most storable field types.
   */
  private generateSimpleCopy(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    const query = sql`
      UPDATE ${sql.raw(this.fullTableName)}
      SET "${sql.raw(this.ctx.targetDbFieldName)}" = "${sql.raw(this.ctx.sourceDbFieldName)}"
    `.compile(this.db);
    return ok([query]);
  }

  /**
   * Returns empty array - no SQL needed for computed/system fields.
   */
  private skipCopy(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return ok([]);
  }

  // === Storable fields: Generate UPDATE SET new = old ===

  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitLongTextField(_field: LongTextField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitNumberField(_field: NumberField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitRatingField(_field: RatingField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitCheckboxField(_field: CheckboxField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitDateField(_field: DateField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitUserField(_field: UserField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  visitAttachmentField(_field: AttachmentField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.generateSimpleCopy();
  }

  // === Computed fields: Skip (values auto-recalculate) ===

  visitFormulaField(_field: FormulaField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitRollupField(_field: RollupField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  // === System/auto-generated fields: Skip ===

  visitAutoNumberField(_field: AutoNumberField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitCreatedTimeField(
    _field: CreatedTimeField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitCreatedByField(_field: CreatedByField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitLastModifiedByField(
    _field: LastModifiedByField
  ): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  visitButtonField(_field: ButtonField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return this.skipCopy();
  }

  // === Link fields: copy value column and relationship storage ===

  visitLinkField(_field: LinkField): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    return safeTry<ReadonlyArray<CompiledQuery>, DomainError>(
      function* (this: FieldValueDuplicateVisitor) {
        const newField = this.ctx.newField;
        if (!newField || !newField.type().equals(FieldType.link())) {
          const valueStatements = yield* this.generateSimpleCopy();
          return ok(valueStatements);
        }

        const linkVisitor = LinkFieldValueDuplicateVisitor.create(this.db, {
          sourceField: _field,
          newField: newField as LinkField,
          schema: this.ctx.schema,
          tableName: this.ctx.tableName,
        });

        const linkStatements = yield* linkVisitor.generateStatements();
        const valueStatements = yield* this.generateSimpleCopy();
        return ok([...valueStatements, ...linkStatements]);
      }.bind(this)
    );
  }
}
