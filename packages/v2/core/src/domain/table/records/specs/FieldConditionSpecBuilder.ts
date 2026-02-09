import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import { FieldType } from '../../fields/FieldType';
import type { ConditionalLookupField } from '../../fields/types/ConditionalLookupField';
import type { LookupField } from '../../fields/types/LookupField';
import type { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import { FieldValueTypeVisitor } from '../../fields/visitors/FieldValueTypeVisitor';
import { AttachmentConditionSpec } from './AttachmentConditionSpec';
import { ButtonConditionSpec } from './ButtonConditionSpec';
import { CheckboxConditionSpec } from './CheckboxConditionSpec';
import { ConditionalLookupConditionSpec } from './ConditionalLookupConditionSpec';
import { ConditionalRollupConditionSpec } from './ConditionalRollupConditionSpec';
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

    const fieldType = this.field.type();
    let effectiveFieldType = fieldType;
    let operatorField: Field = this.field;

    if (fieldType.equals(FieldType.lookup())) {
      const innerResult = (this.field as LookupField).innerField();
      if (innerResult.isErr()) return err(innerResult.error);
      operatorField = innerResult.value;
      effectiveFieldType = innerResult.value.type();
    }

    if (fieldType.equals(FieldType.conditionalLookup())) {
      const innerResult = (this.field as ConditionalLookupField).innerField();
      if (innerResult.isOk()) {
        operatorField = innerResult.value;
      }
      // Keep effectiveFieldType as conditionalLookup for spec routing.
      // If inner field is not yet resolved (e.g. during field creation),
      // fall back to the outer field for operator validation.
    }

    const validOperators = getValidRecordConditionOperators(operatorField, valueTypeResult.value);
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

    const specField = this.field;

    if (effectiveFieldType.equals(FieldType.singleLineText())) {
      const textField = specField as unknown as SingleLineTextField;
      return parseOperator(
        textConditionOperatorSchema,
        input.operator,
        'Invalid operator for singleLineText'
      ).map((operator) => SingleLineTextConditionSpec.create(textField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.longText())) {
      return parseOperator(
        textConditionOperatorSchema,
        input.operator,
        'Invalid operator for longText'
      ).map((operator) => LongTextConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.button())) {
      return parseOperator(
        textConditionOperatorSchema,
        input.operator,
        'Invalid operator for button'
      ).map((operator) => ButtonConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.number())) {
      return parseOperator(
        numberConditionOperatorSchema,
        input.operator,
        'Invalid operator for number'
      ).map((operator) => NumberConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.autoNumber())) {
      return parseOperator(
        numberConditionOperatorSchema,
        input.operator,
        'Invalid operator for autoNumber'
      ).map((operator) => NumberConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.rating())) {
      return parseOperator(
        numberConditionOperatorSchema,
        input.operator,
        'Invalid operator for rating'
      ).map((operator) => RatingConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.checkbox())) {
      return parseOperator(
        booleanConditionOperatorSchema,
        input.operator,
        'Invalid operator for checkbox'
      ).map((operator) => CheckboxConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.date())) {
      return parseOperator(
        dateConditionOperatorSchema,
        input.operator,
        'Invalid operator for date'
      ).map((operator) => DateConditionSpec.create(specField, operator, input.value));
    }

    if (
      effectiveFieldType.equals(FieldType.createdTime()) ||
      effectiveFieldType.equals(FieldType.lastModifiedTime())
    ) {
      return parseOperator(
        dateConditionOperatorSchema,
        input.operator,
        'Invalid operator for system date field'
      ).map((operator) => DateConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.singleSelect())) {
      return parseOperator(
        singleSelectConditionOperatorSchema,
        input.operator,
        'Invalid operator for singleSelect'
      ).map((operator) => SingleSelectConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.multipleSelect())) {
      return parseOperator(
        multipleSelectConditionOperatorSchema,
        input.operator,
        'Invalid operator for multipleSelect'
      ).map((operator) => MultipleSelectConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.attachment())) {
      return parseOperator(
        attachmentConditionOperatorSchema,
        input.operator,
        'Invalid operator for attachment'
      ).map((operator) => AttachmentConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.user())) {
      return parseOperator(
        userConditionOperatorSchema,
        input.operator,
        'Invalid operator for user'
      ).map((operator) => UserConditionSpec.create(specField, operator, input.value));
    }

    if (
      effectiveFieldType.equals(FieldType.createdBy()) ||
      effectiveFieldType.equals(FieldType.lastModifiedBy())
    ) {
      return parseOperator(
        userConditionOperatorSchema,
        input.operator,
        'Invalid operator for system user field'
      ).map((operator) => UserConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.link())) {
      return parseOperator(
        linkConditionOperatorSchema,
        input.operator,
        'Invalid operator for link'
      ).map((operator) => LinkConditionSpec.create(specField, operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.formula())) {
      return ok(FormulaConditionSpec.create(specField, input.operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.rollup())) {
      return ok(RollupConditionSpec.create(specField, input.operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.conditionalRollup())) {
      return ok(ConditionalRollupConditionSpec.create(specField, input.operator, input.value));
    }

    if (effectiveFieldType.equals(FieldType.conditionalLookup())) {
      return ok(ConditionalLookupConditionSpec.create(specField, input.operator, input.value));
    }

    return err(domainError.validation({ message: 'Unsupported record condition field' }));
  }
}
