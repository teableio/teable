import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { DateConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class DateConditionSpec extends RecordValueConditionSpec<DateConditionOperator> {
  private constructor(field: Field, operator: DateConditionOperator, value?: RecordConditionValue) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: DateConditionOperator,
    value?: RecordConditionValue
  ): DateConditionSpec {
    return new DateConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitDateIs(this).map(() => undefined))
      .with('isNot', () => v.visitDateIsNot(this).map(() => undefined))
      .with('isWithIn', () => v.visitDateIsWithIn(this).map(() => undefined))
      .with('isBefore', () => v.visitDateIsBefore(this).map(() => undefined))
      .with('isAfter', () => v.visitDateIsAfter(this).map(() => undefined))
      .with('isOnOrBefore', () => v.visitDateIsOnOrBefore(this).map(() => undefined))
      .with('isOnOrAfter', () => v.visitDateIsOnOrAfter(this).map(() => undefined))
      .with('isEmpty', () => v.visitDateIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitDateIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
