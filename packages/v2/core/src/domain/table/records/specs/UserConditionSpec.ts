import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { UserConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class UserConditionSpec extends RecordValueConditionSpec<UserConditionOperator> {
  private constructor(field: Field, operator: UserConditionOperator, value?: RecordConditionValue) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: UserConditionOperator,
    value?: RecordConditionValue
  ): UserConditionSpec {
    return new UserConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitUserIs(this).map(() => undefined))
      .with('isNot', () => v.visitUserIsNot(this).map(() => undefined))
      .with('isAnyOf', () => v.visitUserIsAnyOf(this).map(() => undefined))
      .with('isNoneOf', () => v.visitUserIsNoneOf(this).map(() => undefined))
      .with('hasAnyOf', () => v.visitUserHasAnyOf(this).map(() => undefined))
      .with('hasAllOf', () => v.visitUserHasAllOf(this).map(() => undefined))
      .with('isExactly', () => v.visitUserIsExactly(this).map(() => undefined))
      .with('isNotExactly', () => v.visitUserIsNotExactly(this).map(() => undefined))
      .with('hasNoneOf', () => v.visitUserHasNoneOf(this).map(() => undefined))
      .with('isEmpty', () => v.visitUserIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitUserIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
