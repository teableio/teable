import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import type { TableId } from '../../TableId';
import { TableId as TableIdVO } from '../../TableId';
import type { FieldId } from '../FieldId';
import { FieldId as FieldIdVO } from '../FieldId';
import { FieldCondition, type FieldConditionDTO } from './FieldCondition';

/**
 * LookupOptions value object for lookup field configuration.
 *
 * Lookup fields retrieve values from a linked table through a Link field.
 * This value object encapsulates the configuration needed to resolve lookup values.
 */

export type LookupOptionsValue = {
  linkFieldId: string;
  lookupFieldId: string;
  foreignTableId: string;
  filter?: FieldConditionDTO['filter'];
  sort?: FieldConditionDTO['sort'];
  limit?: number;
};

const lookupOptionsSchema = z.object({
  linkFieldId: z.string().min(1),
  lookupFieldId: z.string().min(1),
  foreignTableId: z.string().min(1),
  filter: z.unknown().optional(),
  sort: z.unknown().optional(),
  limit: z.unknown().optional(),
});

export class LookupOptions extends ValueObject {
  private constructor(
    private readonly linkFieldIdValue: FieldId,
    private readonly lookupFieldIdValue: FieldId,
    private readonly foreignTableIdValue: TableId,
    private readonly conditionValue?: FieldCondition
  ) {
    super();
  }

  static create(value: unknown): Result<LookupOptions, DomainError> {
    const parseResult = lookupOptionsSchema.safeParse(value);
    if (!parseResult.success) {
      return err(
        domainError.validation({
          code: 'lookup.options.invalid',
          message: 'Invalid LookupOptions',
          details: { issues: parseResult.error.issues },
        })
      );
    }

    const { linkFieldId, lookupFieldId, foreignTableId, filter, sort, limit } = parseResult.data;

    return FieldIdVO.create(linkFieldId).andThen((linkId) =>
      FieldIdVO.create(lookupFieldId).andThen((lookupId) =>
        TableIdVO.create(foreignTableId).andThen((tableId) => {
          const hasCondition = filter !== undefined || sort !== undefined || limit !== undefined;
          const conditionResult = hasCondition
            ? FieldCondition.create({ filter, sort, limit })
            : ok(undefined);

          return conditionResult.map(
            (condition) => new LookupOptions(linkId, lookupId, tableId, condition)
          );
        })
      )
    );
  }

  /**
   * The ID of the Link field that this lookup uses to find related records.
   */
  linkFieldId(): FieldId {
    return this.linkFieldIdValue;
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
   * Optional condition for filtering lookup results.
   */
  condition(): FieldCondition | undefined {
    return this.conditionValue;
  }

  toDto(): LookupOptionsValue {
    const base = {
      linkFieldId: this.linkFieldIdValue.toString(),
      lookupFieldId: this.lookupFieldIdValue.toString(),
      foreignTableId: this.foreignTableIdValue.toString(),
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

  equals(other: LookupOptions): boolean {
    return (
      this.linkFieldIdValue.equals(other.linkFieldIdValue) &&
      this.lookupFieldIdValue.equals(other.lookupFieldIdValue) &&
      this.foreignTableIdValue.equals(other.foreignTableIdValue) &&
      ((this.conditionValue === undefined && other.conditionValue === undefined) ||
        (this.conditionValue !== undefined &&
          other.conditionValue !== undefined &&
          this.conditionValue.equals(other.conditionValue)))
    );
  }
}
