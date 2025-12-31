import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { NumberConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class NumberConditionSpec extends RecordValueConditionSpec<NumberConditionOperator> {
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
  ): NumberConditionSpec {
    return new NumberConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitNumberIs(this).map(() => undefined))
      .with('isNot', () => v.visitNumberIsNot(this).map(() => undefined))
      .with('isGreater', () => v.visitNumberIsGreater(this).map(() => undefined))
      .with('isGreaterEqual', () => v.visitNumberIsGreaterEqual(this).map(() => undefined))
      .with('isLess', () => v.visitNumberIsLess(this).map(() => undefined))
      .with('isLessEqual', () => v.visitNumberIsLessEqual(this).map(() => undefined))
      .with('isEmpty', () => v.visitNumberIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitNumberIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
