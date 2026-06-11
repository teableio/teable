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
  type FormulaField,
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
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  createFieldSchemaRules,
  createSchemaRuleContext,
  PostgresSchemaIntrospector,
  schemaRuleResolver,
  type FieldSchemaRulesContext,
  type SchemaRuleContext,
  type TableSchemaStatementBuilder,
} from '../rules';

/**
 * Visitor that generates schema statements for field deletion.
 *
 * This visitor uses the rules system internally to generate statements.
 * It calls `downAll` on the rules to generate DROP statements in the
 * correct reverse-dependency order.
 */
export class PostgresTableSchemaFieldDeleteVisitor extends AbstractFieldVisitor<
  ReadonlyArray<TableSchemaStatementBuilder>
> {
  private constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private readonly rulesContext: FieldSchemaRulesContext,
    private readonly referenceMode: 'delete' | 'convert' = 'delete'
  ) {
    super();
  }

  static forSchemaUpdate(params: {
    db: Kysely<V1TeableDatabase>;
    schema: string | null;
    tableName: string;
    tableId: string;
  }): PostgresTableSchemaFieldDeleteVisitor {
    return new PostgresTableSchemaFieldDeleteVisitor(params.db, {
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });
  }

  /**
   * Creates a visitor for field conversion (drop+create) that preserves
   * outbound references (from_field_id) so dependent fields keep their
   * cascade edges. Only inbound references (to_field_id) are removed.
   */
  static forConversion(params: {
    db: Kysely<V1TeableDatabase>;
    schema: string | null;
    tableName: string;
    tableId: string;
  }): PostgresTableSchemaFieldDeleteVisitor {
    return new PostgresTableSchemaFieldDeleteVisitor(
      params.db,
      {
        schema: params.schema,
        tableName: params.tableName,
        tableId: params.tableId,
      },
      'convert'
    );
  }

  /**
   * Creates the rule context for a field.
   */
  private createRuleContext(field: Field): SchemaRuleContext {
    return createSchemaRuleContext({
      db: this.db,
      introspector: new PostgresSchemaIntrospector(this.db),
      schema: this.rulesContext.schema,
      tableName: this.rulesContext.tableName,
      tableId: this.rulesContext.tableId,
      field,
    });
  }

  /**
   * Generates DROP statements using the rules system.
   * Calls `downAll` which reverses the dependency order.
   * Uses mode: 'delete' so rules know to fully clean up (e.g., ReferenceRule
   * removes both to_field_id and from_field_id references).
   * In 'convert' mode, uses default mode so ReferenceRule only removes
   * inbound references (to_field_id), preserving outbound edges for
   * dependent fields.
   */
  private generateDropStatementsFromRules(
    field: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(
      function* (this: PostgresTableSchemaFieldDeleteVisitor) {
        const rulesResult = createFieldSchemaRules(field, this.rulesContext);
        const rules = yield* rulesResult;

        const ctx = this.createRuleContext(field);
        const deleteCtx: SchemaRuleContext =
          this.referenceMode === 'convert' ? ctx : { ...ctx, mode: 'delete' };

        return schemaRuleResolver.downAll(rules, deleteCtx);
      }.bind(this)
    );
  }

  // All field types delegate to the rules system
  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitNumberField(
    field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitRatingField(
    field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitFormulaField(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitRollupField(
    field: RollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitDateField(
    field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitCreatedTimeField(
    field: CreatedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitUserField(
    field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitCreatedByField(
    field: CreatedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitAutoNumberField(
    field: AutoNumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitButtonField(
    field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitLinkField(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  override visitLookupField(
    field: LookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateDropStatementsFromRules(field);
  }
}
