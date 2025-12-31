import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { TextConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class SingleLineTextConditionSpec extends RecordValueConditionSpec<TextConditionOperator> {
  private constructor(
    field: SingleLineTextField,
    operator: TextConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: SingleLineTextField,
    operator: TextConditionOperator,
    value?: RecordConditionValue
  ): SingleLineTextConditionSpec {
    return new SingleLineTextConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitSingleLineTextIs(this).map(() => undefined))
      .with('isNot', () => v.visitSingleLineTextIsNot(this).map(() => undefined))
      .with('contains', () => v.visitSingleLineTextContains(this).map(() => undefined))
      .with('doesNotContain', () => v.visitSingleLineTextDoesNotContain(this).map(() => undefined))
      .with('isEmpty', () => v.visitSingleLineTextIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitSingleLineTextIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
