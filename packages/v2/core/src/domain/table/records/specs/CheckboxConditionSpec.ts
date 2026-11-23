import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { BooleanConditionOperator } from './RecordConditionOperators';
import { evaluateCheckboxLiteralCondition, RecordValueConditionSpec } from './RecordConditionSpec';
import { isRecordConditionLiteralValue, type RecordConditionValue } from './RecordConditionValues';

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

  override isSatisfiedBy(record: TableRecord): boolean {
    const value = this.value();
    if (value && isRecordConditionLiteralValue(value) && typeof value.toValue() === 'boolean') {
      const recordValue = record.fields().get(this.field().id())?.toValue();
      return evaluateCheckboxLiteralCondition(recordValue, value.toValue() as boolean);
    }
    return super.isSatisfiedBy(record);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitCheckboxIs(this).map(() => undefined))
      .exhaustive();
  }
}
