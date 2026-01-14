import { getRandomString, type DomainError, type Field } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';

/**
 * A single reference entry (from_field_id -> to_field_id).
 */
export interface ReferenceEntry {
  fromFieldId: string;
  toFieldId: string;
}

/**
 * Schema rule for managing reference table entries.
 * References track field dependencies for computed fields (formula, rollup, lookup, link).
 *
 * This rule verifies that all expected reference entries exist in the reference table.
 */
export class ReferenceRule implements ISchemaRule {
  private static readonly counters = new Map<string, number>();

  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required: boolean;

  /**
   * @param field - The field that has the dependencies
   * @param references - Array of reference entries to create
   * @param options - Optional configuration
   */
  constructor(
    private readonly field: Field,
    private readonly references: ReadonlyArray<ReferenceEntry>,
    private readonly options: {
      fieldType?: string;
      required?: boolean;
    } = {}
  ) {
    this.id = this.buildRuleId();
    this.description = this.buildDescription();
    this.required = this.options.required ?? true;
  }

  private buildRuleId(): string {
    const fieldId = this.field.id().toString();
    const fromIds =
      this.references.length === 0
        ? 'none'
        : this.references.map((ref) => ref.fromFieldId).join(',');
    const baseId = `reference:${fieldId}:${fromIds}`;
    const nextCount = (ReferenceRule.counters.get(baseId) ?? 0) + 1;
    ReferenceRule.counters.set(baseId, nextCount);
    return `${baseId}:${nextCount}`;
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    const type = this.options.fieldType ?? 'computed';
    const count = this.references.length;
    return `Reference entries for ${type} field "${name}" (${count} ${count === 1 ? 'dependency' : 'dependencies'})`;
  }

  /**
   * Creates a ReferenceRule for a single dependency.
   */
  static single(
    field: Field,
    fromFieldId: string,
    options: { fieldType?: string; required?: boolean } = {}
  ): ReferenceRule {
    const toFieldId = field.id().toString();
    return new ReferenceRule(field, [{ toFieldId, fromFieldId }], options);
  }

  /**
   * Creates a ReferenceRule for multiple dependencies (e.g., rollup/lookup).
   */
  static multiple(
    field: Field,
    fromFieldIds: ReadonlyArray<string>,
    options: { fieldType?: string; required?: boolean } = {}
  ): ReferenceRule {
    const toFieldId = field.id().toString();
    const references = fromFieldIds.map((fromFieldId) => ({
      toFieldId,
      fromFieldId,
    }));
    return new ReferenceRule(field, references, options);
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    // If no references expected, always valid
    if (this.references.length === 0) {
      return ok({ valid: true });
    }

    const missingRefs: string[] = [];

    // Check each expected reference entry exists in the reference table
    for (const ref of this.references) {
      const result = await ctx.db
        .selectFrom('reference')
        .select('id')
        .where('to_field_id', '=', ref.toFieldId)
        .where('from_field_id', '=', ref.fromFieldId)
        .executeTakeFirst();

      if (!result) {
        missingRefs.push(`reference entry from "${ref.fromFieldId}" to "${ref.toFieldId}"`);
      }
    }

    if (missingRefs.length > 0) {
      return ok({
        valid: false,
        missing: missingRefs,
      });
    }

    return ok({ valid: true });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    if (this.references.length === 0) {
      return ok([]);
    }

    const values = this.references.map((ref) => ({
      id: getRandomString(25),
      to_field_id: ref.toFieldId,
      from_field_id: ref.fromFieldId,
    }));

    const insert = ctx.db
      .insertInto('reference')
      .values(values)
      .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing());

    return ok([insert]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldId = this.field.id().toString();
    const deleteStatement = ctx.db
      .deleteFrom('reference')
      .where((eb) =>
        eb.or([eb.eb('to_field_id', '=', fieldId), eb.eb('from_field_id', '=', fieldId)])
      );

    return ok([deleteStatement]);
  }
}
