import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldCondition, type FieldConditionDTO } from './FieldCondition';

const rollupFieldConfigSchema = z
  .object({
    linkFieldId: z.string(),
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    filter: z.unknown().optional(),
    sort: z.unknown().optional(),
    limit: z.unknown().optional(),
  })
  .strip();

export type RollupFieldConfigValue = {
  linkFieldId: string;
  foreignTableId: string;
  lookupFieldId: string;
  filter?: FieldConditionDTO['filter'];
  sort?: FieldConditionDTO['sort'];
  limit?: number;
};

/**
 * RollupFieldConfig value object for linked rollup field configuration.
 *
 * Linked rollups aggregate values from a foreign table through a Link field.
 * Optional filter/sort/limit (FieldCondition) mirrors LookupOptions so
 * "More options → Filter records" can be persisted and applied.
 */
export class RollupFieldConfig extends ValueObject {
  private constructor(
    private readonly linkFieldIdValue: FieldId,
    private readonly foreignTableIdValue: TableId,
    private readonly lookupFieldIdValue: FieldId,
    private readonly conditionValue?: FieldCondition
  ) {
    super();
  }

  static create(raw: unknown): Result<RollupFieldConfig, DomainError> {
    const parsed = rollupFieldConfigSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RollupFieldConfig' }));
    const data = parsed.data;

    return FieldId.create(data.linkFieldId).andThen((linkFieldId) =>
      TableId.create(data.foreignTableId).andThen((foreignTableId) =>
        FieldId.create(data.lookupFieldId).andThen((lookupFieldId) => {
          const hasCondition =
            data.filter !== undefined || data.sort !== undefined || data.limit !== undefined;
          const conditionResult = hasCondition
            ? FieldCondition.create({
                filter: data.filter,
                sort: data.sort,
                limit: data.limit,
              })
            : ok(undefined);

          return conditionResult.map(
            (condition) =>
              new RollupFieldConfig(linkFieldId, foreignTableId, lookupFieldId, condition)
          );
        })
      )
    );
  }

  equals(other: RollupFieldConfig): boolean {
    return (
      this.linkFieldIdValue.equals(other.linkFieldIdValue) &&
      this.foreignTableIdValue.equals(other.foreignTableIdValue) &&
      this.lookupFieldIdValue.equals(other.lookupFieldIdValue) &&
      ((this.conditionValue === undefined && other.conditionValue === undefined) ||
        (this.conditionValue !== undefined &&
          other.conditionValue !== undefined &&
          this.conditionValue.equals(other.conditionValue)))
    );
  }

  linkFieldId(): FieldId {
    return this.linkFieldIdValue;
  }

  foreignTableId(): TableId {
    return this.foreignTableIdValue;
  }

  lookupFieldId(): FieldId {
    return this.lookupFieldIdValue;
  }

  /**
   * Optional condition for filtering/sorting/limiting rollup source records.
   */
  condition(): FieldCondition | undefined {
    return this.conditionValue;
  }

  toDto(): RollupFieldConfigValue {
    const base = {
      linkFieldId: this.linkFieldIdValue.toString(),
      foreignTableId: this.foreignTableIdValue.toString(),
      lookupFieldId: this.lookupFieldIdValue.toString(),
    };
    if (!this.conditionValue) {
      return base;
    }
    const condition = this.conditionValue.toDto();
    return {
      ...base,
      filter: condition.filter,
      sort: condition.sort,
      limit: condition.limit,
    };
  }
}
