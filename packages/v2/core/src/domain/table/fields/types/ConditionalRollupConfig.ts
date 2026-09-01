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
import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldCondition, type FieldConditionDTO } from './FieldCondition';

const conditionalRollupConfigSchema = z
  .object({
    baseId: optionalForeignBaseIdSchema,
    foreignTableId: z.string().min(1),
    lookupFieldId: z.string().min(1),
    condition: z.unknown(),
  })
  .strip();

export type ConditionalRollupConfigValue = {
  baseId?: string;
  foreignTableId: string;
  lookupFieldId: string;
  condition: FieldConditionDTO;
};

/**
 * ConditionalRollupConfig value object for conditional rollup field configuration.
 *
 * Unlike regular RollupFieldConfig, ConditionalRollupConfig does NOT have a linkFieldId.
 * Instead, it uses a condition (FieldCondition) to filter records from the foreign table.
 *
 * Contains:
 * - baseId: Optional foreign base for cross-base rollups
 * - foreignTableId: The table to rollup values from
 * - lookupFieldId: The field in the foreign table to aggregate
 * - condition: The FieldCondition to filter which records to include
 */
export class ConditionalRollupConfig extends ValueObject {
  private constructor(
    private readonly baseIdValue: BaseId | undefined,
    private readonly foreignTableIdValue: TableId,
    private readonly lookupFieldIdValue: FieldId,
    private readonly conditionValue: FieldCondition
  ) {
    super();
  }

  /**
   * Creates a ConditionalRollupConfig from raw DTO.
   */
  static create(raw: unknown): Result<ConditionalRollupConfig, DomainError> {
    const parsed = conditionalRollupConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          code: 'conditional_rollup.config.invalid',
          message: 'Invalid ConditionalRollupConfig',
          details: { issues: parsed.error.issues },
        })
      );
    }

    const data = parsed.data;
    return parseOptionalForeignBaseId(data.baseId).andThen((parsedBaseId) =>
      TableId.create(data.foreignTableId).andThen((foreignTableId) =>
        FieldId.create(data.lookupFieldId).andThen((lookupFieldId) =>
          FieldCondition.create(data.condition).andThen((condition) => {
            return ok(
              new ConditionalRollupConfig(
                parsedBaseId,
                foreignTableId,
                lookupFieldId,
                condition
              )
            );
          })
        )
      )
    );
  }

  baseId(): BaseId | undefined {
    return this.baseIdValue;
  }

  /**
   * The ID of the foreign table containing the records to aggregate.
   */
  foreignTableId(): TableId {
    return this.foreignTableIdValue;
  }

  /**
   * The ID of the field in the foreign table whose values will be aggregated.
   */
  lookupFieldId(): FieldId {
    return this.lookupFieldIdValue;
  }

  /**
   * The condition configuration for filtering which records to include.
   */
  condition(): FieldCondition {
    return this.conditionValue;
  }

  toDto(): ConditionalRollupConfigValue {
    return {
      ...(this.baseIdValue ? { baseId: this.baseIdValue.toString() } : {}),
      foreignTableId: this.foreignTableIdValue.toString(),
      lookupFieldId: this.lookupFieldIdValue.toString(),
      condition: this.conditionValue.toDto(),
    };
  }

  equals(other: ConditionalRollupConfig): boolean {
    return (
      optionalBaseIdsEqual(this.baseIdValue, other.baseIdValue) &&
      this.foreignTableIdValue.equals(other.foreignTableIdValue) &&
      this.lookupFieldIdValue.equals(other.lookupFieldIdValue) &&
      this.conditionValue.equals(other.conditionValue)
    );
  }
}
