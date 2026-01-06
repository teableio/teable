import type { DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';

/**
 * Schema rule for updating field metadata in the field table.
 * This is a metadata-only rule, not a physical schema rule.
 */
export class FieldMetaRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  /**
   * @param fieldId - The field ID to update metadata for
   * @param meta - The metadata object to store
   * @param options - Optional configuration
   */
  constructor(
    private readonly fieldId: string,
    private readonly meta: Record<string, unknown>,
    private readonly options: {
      dependsOnRuleIds?: ReadonlyArray<string>;
      fieldName?: string;
    } = {}
  ) {
    this.id = `field_meta:${fieldId}`;
    this.dependencies = this.options.dependsOnRuleIds ?? [];
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.options.fieldName ?? this.fieldId;
    const keys = Object.keys(this.meta).join(', ');
    return `Field metadata for "${name}" (${keys})`;
  }

  /**
   * Creates a FieldMetaRule for hasOrderColumn metadata.
   */
  static forOrderColumn(
    fieldId: string,
    options: { dependsOnRuleId?: string; fieldName?: string } = {}
  ): FieldMetaRule {
    return new FieldMetaRule(
      fieldId,
      { hasOrderColumn: true },
      {
        dependsOnRuleIds: options.dependsOnRuleId ? [options.dependsOnRuleId] : [],
        fieldName: options.fieldName,
      }
    );
  }

  async isValid(_ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    // Metadata updates are always considered valid (idempotent)
    return ok({ valid: true });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const updateMeta = ctx.db
      .updateTable('field')
      .set({ meta: JSON.stringify(this.meta) })
      .where('id', '=', this.fieldId);

    return ok([updateMeta]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Clear metadata on down (set to empty object)
    const updateMeta = ctx.db
      .updateTable('field')
      .set({ meta: JSON.stringify({}) })
      .where('id', '=', this.fieldId);

    return ok([updateMeta]);
  }
}
