import type { DomainError, Field } from '@teable/v2-core';
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
 * This is a metadata rule that verifies the field's meta column contains expected values.
 */
export class FieldMetaRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  /**
   * @param field - The field to update metadata for
   * @param meta - The metadata object to store
   * @param dependsOnRuleId - Optional rule ID this depends on
   */
  constructor(
    private readonly field: Field,
    private readonly meta: Record<string, unknown>,
    dependsOnRuleId?: string
  ) {
    this.id = `field_meta:${field.id().toString()}`;
    this.dependencies = dependsOnRuleId ? [dependsOnRuleId] : [];
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    const keys = Object.keys(this.meta).join(', ');
    return `Field metadata for "${name}" (${keys})`;
  }

  /**
   * Creates a FieldMetaRule for hasOrderColumn metadata.
   */
  static forOrderColumn(field: Field, options: { dependsOnRuleId?: string } = {}): FieldMetaRule {
    return new FieldMetaRule(field, { hasOrderColumn: true }, options.dependsOnRuleId);
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const fieldId = this.field.id().toString();
    const expectedMeta = this.meta;

    // Query the field table to get current meta value
    const result = await ctx.db
      .selectFrom('field')
      .select('meta')
      .where('id', '=', fieldId)
      .executeTakeFirst();

    if (!result) {
      return ok({
        valid: false,
        missing: [`field record with id "${fieldId}" not found in field table`],
      });
    }

    // Parse the current meta value
    let currentMeta: Record<string, unknown> = {};
    if (result.meta) {
      try {
        currentMeta =
          typeof result.meta === 'string'
            ? JSON.parse(result.meta)
            : (result.meta as Record<string, unknown>);
      } catch {
        return ok({
          valid: false,
          missing: [`field "${fieldId}" has invalid JSON in meta column`],
        });
      }
    }

    // Check if all expected keys are present with correct values
    const missingOrWrong: string[] = [];
    for (const [key, expectedValue] of Object.entries(expectedMeta)) {
      const actualValue = currentMeta[key];
      if (actualValue !== expectedValue) {
        if (actualValue === undefined) {
          missingOrWrong.push(
            `meta.${key} is missing (expected: ${JSON.stringify(expectedValue)})`
          );
        } else {
          missingOrWrong.push(
            `meta.${key} is ${JSON.stringify(actualValue)} (expected: ${JSON.stringify(expectedValue)})`
          );
        }
      }
    }

    if (missingOrWrong.length > 0) {
      return ok({
        valid: false,
        missing: missingOrWrong,
      });
    }

    return ok({ valid: true });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldId = this.field.id().toString();
    const updateMeta = ctx.db
      .updateTable('field')
      .set({ meta: JSON.stringify(this.meta) })
      .where('id', '=', fieldId);

    return ok([updateMeta]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldId = this.field.id().toString();
    // Clear metadata on down (set to empty object)
    const updateMeta = ctx.db
      .updateTable('field')
      .set({ meta: JSON.stringify({}) })
      .where('id', '=', fieldId);

    return ok([updateMeta]);
  }
}
