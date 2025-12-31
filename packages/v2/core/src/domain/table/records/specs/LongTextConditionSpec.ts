import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { TextConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class LongTextConditionSpec extends RecordValueConditionSpec<TextConditionOperator> {
  private constructor(field: Field, operator: TextConditionOperator, value?: RecordConditionValue) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: TextConditionOperator,
    value?: RecordConditionValue
  ): LongTextConditionSpec {
    return new LongTextConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitLongTextIs(this).map(() => undefined))
      .with('isNot', () => v.visitLongTextIsNot(this).map(() => undefined))
      .with('contains', () => v.visitLongTextContains(this).map(() => undefined))
      .with('doesNotContain', () => v.visitLongTextDoesNotContain(this).map(() => undefined))
      .with('isEmpty', () => v.visitLongTextIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitLongTextIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
