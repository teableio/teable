import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { BooleanConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class CheckboxConditionSpec extends RecordValueConditionSpec<BooleanConditionOperator> {
  private constructor(
    field: Field,
    operator: BooleanConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: BooleanConditionOperator,
    value?: RecordConditionValue
  ): CheckboxConditionSpec {
    return new CheckboxConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitCheckboxIs(this).map(() => undefined))
      .exhaustive();
  }
}
