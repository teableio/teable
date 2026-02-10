import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { RecordConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

/**
 * Condition specification for ConditionalRollup fields.
 *
 * Similar to RollupConditionSpec, ConditionalRollup fields aggregate values
 * from a foreign table and support the same operators.
 * The difference is in how values are sourced (via condition vs. link field).
 */
export class ConditionalRollupConditionSpec extends RecordValueConditionSpec<RecordConditionOperator> {
  private constructor(
    field: Field,
    operator: RecordConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: RecordConditionOperator,
    value?: RecordConditionValue
  ): ConditionalRollupConditionSpec {
    return new ConditionalRollupConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitConditionalRollupIs(this).map(() => undefined))
      .with('isNot', () => v.visitConditionalRollupIsNot(this).map(() => undefined))
      .with('contains', () => v.visitConditionalRollupContains(this).map(() => undefined))
      .with('doesNotContain', () =>
        v.visitConditionalRollupDoesNotContain(this).map(() => undefined)
      )
      .with('isEmpty', () => v.visitConditionalRollupIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitConditionalRollupIsNotEmpty(this).map(() => undefined))
      .with('isGreater', () => v.visitConditionalRollupIsGreater(this).map(() => undefined))
      .with('isGreaterEqual', () =>
        v.visitConditionalRollupIsGreaterEqual(this).map(() => undefined)
      )
      .with('isLess', () => v.visitConditionalRollupIsLess(this).map(() => undefined))
      .with('isLessEqual', () => v.visitConditionalRollupIsLessEqual(this).map(() => undefined))
      .with('isAnyOf', () => v.visitConditionalRollupIsAnyOf(this).map(() => undefined))
      .with('isNoneOf', () => v.visitConditionalRollupIsNoneOf(this).map(() => undefined))
      .with('hasAnyOf', () => v.visitConditionalRollupHasAnyOf(this).map(() => undefined))
      .with('hasAllOf', () => v.visitConditionalRollupHasAllOf(this).map(() => undefined))
      .with('isNotExactly', () => v.visitConditionalRollupIsNotExactly(this).map(() => undefined))
      .with('hasNoneOf', () => v.visitConditionalRollupHasNoneOf(this).map(() => undefined))
      .with('isExactly', () => v.visitConditionalRollupIsExactly(this).map(() => undefined))
      .with('isWithIn', () => v.visitConditionalRollupIsWithIn(this).map(() => undefined))
      .with('isBefore', () => v.visitConditionalRollupIsBefore(this).map(() => undefined))
      .with('isAfter', () => v.visitConditionalRollupIsAfter(this).map(() => undefined))
      .with('isOnOrBefore', () => v.visitConditionalRollupIsOnOrBefore(this).map(() => undefined))
      .with('isOnOrAfter', () => v.visitConditionalRollupIsOnOrAfter(this).map(() => undefined))
      .exhaustive();
  }
}
