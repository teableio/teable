import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { RecordConditionOperator } from './RecordConditionOperators';
import type { RecordConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export type RecordConditionSpecInput = {
  field: Field;
  operator: RecordConditionOperator;
  value?: RecordConditionValue;
};

export const createRecordConditionSpec = (
  input: RecordConditionSpecInput
): Result<RecordConditionSpec<ITableRecordConditionSpecVisitor>, DomainError> => {
  return input.field.spec().create({ operator: input.operator, value: input.value });
};
