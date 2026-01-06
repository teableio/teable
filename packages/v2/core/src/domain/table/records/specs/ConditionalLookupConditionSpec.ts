import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { RecordConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

/**
 * Condition specification for ConditionalLookup fields.
 *
 * ConditionalLookup fields retrieve values from a foreign table based on
 * a condition filter (not a link relationship). The values are always
 * multi-valued (array), similar to regular Lookup fields.
 */
export class ConditionalLookupConditionSpec extends RecordValueConditionSpec<RecordConditionOperator> {
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
  ): ConditionalLookupConditionSpec {
    return new ConditionalLookupConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return (
      match(this.operator())
        .with('is', () => v.visitConditionalLookupIs(this).map(() => undefined))
        .with('isNot', () => v.visitConditionalLookupIsNot(this).map(() => undefined))
        .with('contains', () => v.visitConditionalLookupContains(this).map(() => undefined))
        .with('doesNotContain', () =>
          v.visitConditionalLookupDoesNotContain(this).map(() => undefined)
        )
        .with('isEmpty', () => v.visitConditionalLookupIsEmpty(this).map(() => undefined))
        .with('isNotEmpty', () => v.visitConditionalLookupIsNotEmpty(this).map(() => undefined))
        .with('isAnyOf', () => v.visitConditionalLookupIsAnyOf(this).map(() => undefined))
        .with('isNoneOf', () => v.visitConditionalLookupIsNoneOf(this).map(() => undefined))
        .with('hasAnyOf', () => v.visitConditionalLookupHasAnyOf(this).map(() => undefined))
        .with('hasAllOf', () => v.visitConditionalLookupHasAllOf(this).map(() => undefined))
        .with('isNotExactly', () => v.visitConditionalLookupIsNotExactly(this).map(() => undefined))
        .with('hasNoneOf', () => v.visitConditionalLookupHasNoneOf(this).map(() => undefined))
        .with('isExactly', () => v.visitConditionalLookupIsExactly(this).map(() => undefined))
        // Numeric and date operators - return error as lookup is array-based
        .with(
          'isGreater',
          'isGreaterEqual',
          'isLess',
          'isLessEqual',
          'isWithIn',
          'isBefore',
          'isAfter',
          'isOnOrBefore',
          'isOnOrAfter',
          () => v.visitConditionalLookupIsEmpty(this).map(() => undefined)
        )
        .exhaustive()
    );
  }
}
