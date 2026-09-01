import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { BaseId } from '../../../base/BaseId';
import {
  optionalBaseIdsEqual,
  optionalForeignBaseIdSchema,
  parseOptionalForeignBaseId,
} from '../../../base/optionalForeignBaseId';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import type { TableId } from '../../TableId';
import { TableId as TableIdVO } from '../../TableId';
import type { FieldId } from '../FieldId';
import { FieldId as FieldIdVO } from '../FieldId';
import { FieldCondition, type FieldConditionDTO } from './FieldCondition';

const conditionalLookupOptionsSchema = z.object({
  baseId: optionalForeignBaseIdSchema,
  foreignTableId: z.string().min(1),
  lookupFieldId: z.string().min(1),
  condition: z.unknown(),
});

export type ConditionalLookupOptionsValue = {
  baseId?: string;
  foreignTableId: string;
  lookupFieldId: string;
  condition: FieldConditionDTO;
};

/**
 * ConditionalLookupOptions value object for conditional lookup field configuration.
 *
 * Unlike regular LookupOptions, ConditionalLookupOptions does NOT have a linkFieldId.
 * Instead, it uses a condition (FieldCondition) to filter records from the foreign table.
 *
 * Similar to LookupField, ConditionalLookupField is a "wrapper" type that wraps an
 * inner field (the lookup field in the foreign table).
 *
 * Contains:
 * - baseId: Optional foreign base for cross-base lookups
 * - foreignTableId: The table to lookup values from
 * - lookupFieldId: The field in the foreign table whose values will be looked up
 * - condition: The FieldCondition to filter which records to include
 */
export class ConditionalLookupOptions extends ValueObject {
  private constructor(
    private readonly baseIdValue: BaseId | undefined,
    private readonly foreignTableIdValue: TableId,
    private readonly lookupFieldIdValue: FieldId,
    private readonly conditionValue: FieldCondition
  ) {
    super();
  }

  /**
   * Creates a ConditionalLookupOptions from raw DTO.
   */
  static create(value: unknown): Result<ConditionalLookupOptions, DomainError> {
    const parseResult = conditionalLookupOptionsSchema.safeParse(value);
    if (!parseResult.success) {
      return err(
        domainError.validation({
          code: 'conditional_lookup.options.invalid',
          message: 'Invalid ConditionalLookupOptions',
          details: { issues: parseResult.error.issues },
        })
      );
    }

    const { baseId, foreignTableId, lookupFieldId, condition } = parseResult.data;
    return parseOptionalForeignBaseId(baseId).andThen((parsedBaseId) =>
      FieldIdVO.create(lookupFieldId).andThen((lookupId) =>
        TableIdVO.create(foreignTableId).andThen((tableId) =>
          FieldCondition.create(condition).andThen((cond) => {
            // Validate that condition has at least one filter item
            if (!cond.hasFilter()) {
              return err(
                domainError.validation({
                  code: 'conditional_lookup.options.condition_required',
                  message: 'ConditionalLookupOptions condition must have at least one filter item',
                })
              );
            }
            return ok(new ConditionalLookupOptions(parsedBaseId, tableId, lookupId, cond));
          })
        )
      )
    );
  }

  baseId(): BaseId | undefined {
    return this.baseIdValue;
  }

  /**
   * The ID of the field in the foreign table whose values will be looked up.
   */
  lookupFieldId(): FieldId {
    return this.lookupFieldIdValue;
  }

  /**
   * The ID of the foreign table containing the lookup field.
   */
  foreignTableId(): TableId {
    return this.foreignTableIdValue;
  }

  /**
   * The condition configuration for filtering which records to include.
   */
  condition(): FieldCondition {
    return this.conditionValue;
  }

  toDto(): ConditionalLookupOptionsValue {
    return {
      ...(this.baseIdValue ? { baseId: this.baseIdValue.toString() } : {}),
      foreignTableId: this.foreignTableIdValue.toString(),
      lookupFieldId: this.lookupFieldIdValue.toString(),
      condition: this.conditionValue.toDto(),
    };
  }

  equals(other: ConditionalLookupOptions): boolean {
    return (
      optionalBaseIdsEqual(this.baseIdValue, other.baseIdValue) &&
      this.foreignTableIdValue.equals(other.foreignTableIdValue) &&
      this.lookupFieldIdValue.equals(other.lookupFieldIdValue) &&
      this.conditionValue.equals(other.conditionValue)
    );
  }
}
