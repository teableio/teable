import type { DomainError, LinkField } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';

/**
 * Schema rule for validating Link field symmetric relationship integrity.
 *
 * This rule checks for common data corruption issues in link fields:
 * 1. symmetricFieldId points to a non-existent field
 * 2. symmetricFieldId points to a non-link field (e.g., formula field)
 * 3. Bidirectional relationship is broken (A -> B, but B -/-> A)
 * 4. Multiple link fields share the same symmetricFieldId (should be unique)
 */
export class LinkSymmetricFieldRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  private constructor(
    private readonly field: LinkField,
    private readonly symmetricFieldId: string
  ) {
    this.id = `symmetric_field:${field.id().toString()}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    return `Symmetric field relationship for "${name}"`;
  }

  /**
   * Creates a LinkSymmetricFieldRule for a two-way link field.
   * Returns undefined for one-way links (no symmetric field to validate).
   */
  static forField(field: LinkField): LinkSymmetricFieldRule | undefined {
    if (field.isOneWay()) {
      return undefined;
    }

    const symmetricFieldId = field.symmetricFieldId();
    if (!symmetricFieldId) {
      return undefined;
    }

    return new LinkSymmetricFieldRule(field, symmetricFieldId.toString());
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const currentFieldId = this.field.id().toString();
    const symmetricFieldId = this.symmetricFieldId;
    const missing: string[] = [];

    // 1. Check if symmetric field exists and get its details
    const symmetricFieldResult = await ctx.db
      .selectFrom('field')
      .select(['id', 'name', 'type', 'options'])
      .where('id', '=', symmetricFieldId)
      .executeTakeFirst();

    if (!symmetricFieldResult) {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" does not exist (field may have been deleted)`
      );
      return ok({ valid: false, missing });
    }

    // 2. Check if symmetric field is a link type
    if (symmetricFieldResult.type !== 'link') {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) is type "${symmetricFieldResult.type}", expected "link"`
      );
      return ok({ valid: false, missing });
    }

    // 3. Check bidirectional consistency: symmetric field should point back to this field
    let symmetricOptions: { symmetricFieldId?: string } = {};
    if (symmetricFieldResult.options) {
      try {
        symmetricOptions =
          typeof symmetricFieldResult.options === 'string'
            ? JSON.parse(symmetricFieldResult.options)
            : (symmetricFieldResult.options as { symmetricFieldId?: string });
      } catch {
        missing.push(
          `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) has invalid JSON in options column`
        );
        return ok({ valid: false, missing });
      }
    }

    const backReference = symmetricOptions.symmetricFieldId;
    if (!backReference) {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) has no symmetricFieldId (broken bidirectional link)`
      );
      return ok({ valid: false, missing });
    }

    if (backReference !== currentFieldId) {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) points to "${backReference}", expected "${currentFieldId}" (broken bidirectional link)`
      );
      return ok({ valid: false, missing });
    }

    // 4. Check for duplicate symmetric field references (uniqueness)
    // Find all link fields that reference the same symmetricFieldId
    const duplicateResult = await ctx.db
      .selectFrom('field')
      .select(['id', 'name'])
      .where('type', '=', 'link')
      .where('id', '!=', currentFieldId)
      .where((eb) =>
        eb.or([
          eb('options', 'like', `%"symmetricFieldId":"${symmetricFieldId}"%`),
          eb('options', 'like', `%"symmetricFieldId": "${symmetricFieldId}"%`),
        ])
      )
      .execute();

    if (duplicateResult.length > 0) {
      const duplicates = duplicateResult.map((r) => `${r.id} (${r.name})`).join(', ');
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" is also used by: ${duplicates} (should be unique)`
      );
      return ok({ valid: false, missing });
    }

    return ok({ valid: true });
  }

  /**
   * This rule is validation-only. Symmetric field corruption cannot be auto-fixed
   * and requires manual intervention to resolve.
   */
  up(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  /**
   * This rule is validation-only.
   */
  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }
}
