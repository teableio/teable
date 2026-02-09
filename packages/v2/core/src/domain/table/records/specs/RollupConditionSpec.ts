import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { RecordConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class RollupConditionSpec extends RecordValueConditionSpec<RecordConditionOperator> {
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
  ): RollupConditionSpec {
    return new RollupConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitRollupIs(this).map(() => undefined))
      .with('isNot', () => v.visitRollupIsNot(this).map(() => undefined))
      .with('contains', () => v.visitRollupContains(this).map(() => undefined))
      .with('doesNotContain', () => v.visitRollupDoesNotContain(this).map(() => undefined))
      .with('isEmpty', () => v.visitRollupIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitRollupIsNotEmpty(this).map(() => undefined))
      .with('isGreater', () => v.visitRollupIsGreater(this).map(() => undefined))
      .with('isGreaterEqual', () => v.visitRollupIsGreaterEqual(this).map(() => undefined))
      .with('isLess', () => v.visitRollupIsLess(this).map(() => undefined))
      .with('isLessEqual', () => v.visitRollupIsLessEqual(this).map(() => undefined))
      .with('isAnyOf', () => v.visitRollupIsAnyOf(this).map(() => undefined))
      .with('isNoneOf', () => v.visitRollupIsNoneOf(this).map(() => undefined))
      .with('hasAnyOf', () => v.visitRollupHasAnyOf(this).map(() => undefined))
      .with('hasAllOf', () => v.visitRollupHasAllOf(this).map(() => undefined))
      .with('isNotExactly', () => v.visitRollupIsNotExactly(this).map(() => undefined))
      .with('hasNoneOf', () => v.visitRollupHasNoneOf(this).map(() => undefined))
      .with('isExactly', () => v.visitRollupIsExactly(this).map(() => undefined))
      .with('isWithIn', () => v.visitRollupIsWithIn(this).map(() => undefined))
      .with('isBefore', () => v.visitRollupIsBefore(this).map(() => undefined))
      .with('isAfter', () => v.visitRollupIsAfter(this).map(() => undefined))
      .with('isOnOrBefore', () => v.visitRollupIsOnOrBefore(this).map(() => undefined))
      .with('isOnOrAfter', () => v.visitRollupIsOnOrAfter(this).map(() => undefined))
      .exhaustive();
  }
}
