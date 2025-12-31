import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import { FieldType } from '../../fields/FieldType';
import type { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import { FieldValueTypeVisitor } from '../../fields/visitors/FieldValueTypeVisitor';
import { AttachmentConditionSpec } from './AttachmentConditionSpec';
import { ButtonConditionSpec } from './ButtonConditionSpec';
import { CheckboxConditionSpec } from './CheckboxConditionSpec';
import { DateConditionSpec } from './DateConditionSpec';
import { FormulaConditionSpec } from './FormulaConditionSpec';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import { LinkConditionSpec } from './LinkConditionSpec';
import { LongTextConditionSpec } from './LongTextConditionSpec';
import { MultipleSelectConditionSpec } from './MultipleSelectConditionSpec';
import { NumberConditionSpec } from './NumberConditionSpec';
import { RatingConditionSpec } from './RatingConditionSpec';
import type { RecordConditionOperator } from './RecordConditionOperators';
import {
  attachmentConditionOperatorSchema,
  booleanConditionOperatorSchema,
  dateConditionOperatorSchema,
  getValidRecordConditionOperators,
  linkConditionOperatorSchema,
  multipleSelectConditionOperatorSchema,
  numberConditionOperatorSchema,
  recordConditionOperatorsExpectingArray,
  recordConditionOperatorsExpectingNull,
  singleSelectConditionOperatorSchema,
  textConditionOperatorSchema,
  userConditionOperatorSchema,
} from './RecordConditionOperators';
import type { RecordConditionSpec } from './RecordConditionSpec';
import {
  isRecordConditionFieldReferenceValue,
  isRecordConditionLiteralListValue,
  type RecordConditionValue,
} from './RecordConditionValues';
import { RollupConditionSpec } from './RollupConditionSpec';
import { SingleLineTextConditionSpec } from './SingleLineTextConditionSpec';
import { SingleSelectConditionSpec } from './SingleSelectConditionSpec';
import { UserConditionSpec } from './UserConditionSpec';

export type FieldConditionSpecInput = {
  operator: RecordConditionOperator;
  value?: RecordConditionValue;
};

const parseOperator = <T>(
  schema: z.ZodType<T>,
  value: RecordConditionOperator,
  message: string
): Result<T, DomainError> => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return err(domainError.unexpected({ message: message }));
  return ok(parsed.data);
};

export class FieldConditionSpecBuilder {
  private constructor(private readonly field: Field) {}

  static create(field: Field): FieldConditionSpecBuilder {
    return new FieldConditionSpecBuilder(field);
  }

  create(
    input: FieldConditionSpecInput
  ): Result<RecordConditionSpec<ITableRecordConditionSpecVisitor>, DomainError> {
    const valueTypeResult = this.field.accept(new FieldValueTypeVisitor());
    if (valueTypeResult.isErr()) return err(valueTypeResult.error);

    const validOperators = getValidRecordConditionOperators(this.field, valueTypeResult.value);
    if (!validOperators.includes(input.operator)) {
      return err(
        domainError.validation({ message: 'Invalid record condition operator for field' })
      );
    }

    if (recordConditionOperatorsExpectingNull.includes(input.operator)) {
      if (input.value)
        return err(domainError.unexpected({ message: 'Record condition expects null value' }));
    } else {
      if (!input.value)
        return err(domainError.unexpected({ message: 'Record condition requires a value' }));
    }

    if (recordConditionOperatorsExpectingArray.includes(input.operator)) {
      if (input.value && !isRecordConditionLiteralListValue(input.value)) {
        if (!isRecordConditionFieldReferenceValue(input.value)) {
          return err(domainError.unexpected({ message: 'Record condition requires list value' }));
        }
      }
    } else if (input.value && isRecordConditionLiteralListValue(input.value)) {
      return err(domainError.validation({ message: 'Record condition does not allow list value' }));
    }

    const fieldType = this.field.type();

    if (fieldType.equals(FieldType.singleLineText())) {
      const textField = this.field as SingleLineTextField;
      return parseOperator(
        textConditionOperatorSchema,
        input.operator,
        'Invalid operator for singleLineText'
      ).map((operator) => SingleLineTextConditionSpec.create(textField, operator, input.value));
    }

    if (fieldType.equals(FieldType.longText())) {
      return parseOperator(
        textConditionOperatorSchema,
        input.operator,
        'Invalid operator for longText'
      ).map((operator) => LongTextConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.button())) {
      return parseOperator(
        textConditionOperatorSchema,
        input.operator,
        'Invalid operator for button'
      ).map((operator) => ButtonConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.number())) {
      return parseOperator(
        numberConditionOperatorSchema,
        input.operator,
        'Invalid operator for number'
      ).map((operator) => NumberConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.autoNumber())) {
      return parseOperator(
        numberConditionOperatorSchema,
        input.operator,
        'Invalid operator for autoNumber'
      ).map((operator) => NumberConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.rating())) {
      return parseOperator(
        numberConditionOperatorSchema,
        input.operator,
        'Invalid operator for rating'
      ).map((operator) => RatingConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.checkbox())) {
      return parseOperator(
        booleanConditionOperatorSchema,
        input.operator,
        'Invalid operator for checkbox'
      ).map((operator) => CheckboxConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.date())) {
      return parseOperator(
        dateConditionOperatorSchema,
        input.operator,
        'Invalid operator for date'
      ).map((operator) => DateConditionSpec.create(this.field, operator, input.value));
    }

    if (
      fieldType.equals(FieldType.createdTime()) ||
      fieldType.equals(FieldType.lastModifiedTime())
    ) {
      return parseOperator(
        dateConditionOperatorSchema,
        input.operator,
        'Invalid operator for system date field'
      ).map((operator) => DateConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.singleSelect())) {
      return parseOperator(
        singleSelectConditionOperatorSchema,
        input.operator,
        'Invalid operator for singleSelect'
      ).map((operator) => SingleSelectConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.multipleSelect())) {
      return parseOperator(
        multipleSelectConditionOperatorSchema,
        input.operator,
        'Invalid operator for multipleSelect'
      ).map((operator) => MultipleSelectConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.attachment())) {
      return parseOperator(
        attachmentConditionOperatorSchema,
        input.operator,
        'Invalid operator for attachment'
      ).map((operator) => AttachmentConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.user())) {
      return parseOperator(
        userConditionOperatorSchema,
        input.operator,
        'Invalid operator for user'
      ).map((operator) => UserConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.createdBy()) || fieldType.equals(FieldType.lastModifiedBy())) {
      return parseOperator(
        userConditionOperatorSchema,
        input.operator,
        'Invalid operator for system user field'
      ).map((operator) => UserConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.link())) {
      return parseOperator(
        linkConditionOperatorSchema,
        input.operator,
        'Invalid operator for link'
      ).map((operator) => LinkConditionSpec.create(this.field, operator, input.value));
    }

    if (fieldType.equals(FieldType.formula())) {
      return ok(FormulaConditionSpec.create(this.field, input.operator, input.value));
    }

    if (fieldType.equals(FieldType.rollup())) {
      return ok(RollupConditionSpec.create(this.field, input.operator, input.value));
    }

    return err(domainError.validation({ message: 'Unsupported record condition field' }));
  }
}
