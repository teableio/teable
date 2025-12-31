import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { SingleSelectConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class SingleSelectConditionSpec extends RecordValueConditionSpec<SingleSelectConditionOperator> {
  private constructor(
    field: Field,
    operator: SingleSelectConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: SingleSelectConditionOperator,
    value?: RecordConditionValue
  ): SingleSelectConditionSpec {
    return new SingleSelectConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitSingleSelectIs(this).map(() => undefined))
      .with('isNot', () => v.visitSingleSelectIsNot(this).map(() => undefined))
      .with('isAnyOf', () => v.visitSingleSelectIsAnyOf(this).map(() => undefined))
      .with('isNoneOf', () => v.visitSingleSelectIsNoneOf(this).map(() => undefined))
      .with('isEmpty', () => v.visitSingleSelectIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitSingleSelectIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
