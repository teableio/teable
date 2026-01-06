import { getRandomString, type DomainError } from '@teable/v2-core';
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
 * Note: isValid queries the reference table, not information_schema.
 * This is a metadata rule rather than a physical schema rule.
 */
export class ReferenceRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  /**
   * @param fieldId - The field ID that has the dependencies (to_field_id)
   * @param references - Array of reference entries to create
   * @param options - Optional configuration
   */
  constructor(
    private readonly fieldId: string,
    private readonly references: ReadonlyArray<ReferenceEntry>,
    private readonly options: {
      fieldName?: string;
      fieldType?: string;
    } = {}
  ) {
    this.id = `reference:${fieldId}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.options.fieldName ?? this.fieldId;
    const type = this.options.fieldType ?? 'computed';
    const count = this.references.length;
    return `Reference entries for ${type} field "${name}" (${count} ${count === 1 ? 'dependency' : 'dependencies'})`;
  }

  /**
   * Creates a ReferenceRule for a single dependency.
   */
  static single(
    toFieldId: string,
    fromFieldId: string,
    options: { fieldName?: string; fieldType?: string } = {}
  ): ReferenceRule {
    return new ReferenceRule(toFieldId, [{ toFieldId, fromFieldId }], options);
  }

  /**
   * Creates a ReferenceRule for multiple dependencies (e.g., rollup/lookup).
   */
  static multiple(
    toFieldId: string,
    fromFieldIds: ReadonlyArray<string>,
    options: { fieldName?: string; fieldType?: string } = {}
  ): ReferenceRule {
    const references = fromFieldIds.map((fromFieldId) => ({
      toFieldId,
      fromFieldId,
    }));
    return new ReferenceRule(toFieldId, references, options);
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    // For now, always return valid = true since reference entries are upserted
    // A more complete implementation would query the reference table
    // But this is metadata, not physical schema
    void ctx;
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
    const fieldId = this.fieldId;
    const deleteStatement = ctx.db
      .deleteFrom('reference')
      .where((eb) =>
        eb.or([eb.eb('to_field_id', '=', fieldId), eb.eb('from_field_id', '=', fieldId)])
      );

    return ok([deleteStatement]);
  }
}
