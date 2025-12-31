import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { MultipleSelectConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class MultipleSelectConditionSpec extends RecordValueConditionSpec<MultipleSelectConditionOperator> {
  private constructor(
    field: Field,
    operator: MultipleSelectConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: MultipleSelectConditionOperator,
    value?: RecordConditionValue
  ): MultipleSelectConditionSpec {
    return new MultipleSelectConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('hasAnyOf', () => v.visitMultipleSelectHasAnyOf(this).map(() => undefined))
      .with('hasAllOf', () => v.visitMultipleSelectHasAllOf(this).map(() => undefined))
      .with('isExactly', () => v.visitMultipleSelectIsExactly(this).map(() => undefined))
      .with('isNotExactly', () => v.visitMultipleSelectIsNotExactly(this).map(() => undefined))
      .with('hasNoneOf', () => v.visitMultipleSelectHasNoneOf(this).map(() => undefined))
      .with('isEmpty', () => v.visitMultipleSelectIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitMultipleSelectIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
