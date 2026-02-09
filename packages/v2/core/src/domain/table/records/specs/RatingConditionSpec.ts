import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { NumberConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class RatingConditionSpec extends RecordValueConditionSpec<NumberConditionOperator> {
  private constructor(
    field: Field,
    operator: NumberConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: NumberConditionOperator,
    value?: RecordConditionValue
  ): RatingConditionSpec {
    return new RatingConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitRatingIs(this).map(() => undefined))
      .with('isNot', () => v.visitRatingIsNot(this).map(() => undefined))
      .with('isGreater', () => v.visitRatingIsGreater(this).map(() => undefined))
      .with('isGreaterEqual', () => v.visitRatingIsGreaterEqual(this).map(() => undefined))
      .with('isLess', () => v.visitRatingIsLess(this).map(() => undefined))
      .with('isLessEqual', () => v.visitRatingIsLessEqual(this).map(() => undefined))
      .with('isEmpty', () => v.visitRatingIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitRatingIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
