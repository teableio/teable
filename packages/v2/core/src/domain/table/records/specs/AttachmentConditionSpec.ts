import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { AttachmentConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class AttachmentConditionSpec extends RecordValueConditionSpec<AttachmentConditionOperator> {
  private constructor(
    field: Field,
    operator: AttachmentConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: AttachmentConditionOperator,
    value?: RecordConditionValue
  ): AttachmentConditionSpec {
    return new AttachmentConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('isEmpty', () => v.visitAttachmentIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitAttachmentIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
