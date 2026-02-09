import { describe, expect, it } from 'vitest';

import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { AttachmentField } from '../../fields/types/AttachmentField';
import { ButtonField } from '../../fields/types/ButtonField';
import { CellValueMultiplicity } from '../../fields/types/CellValueMultiplicity';
import { CellValueType } from '../../fields/types/CellValueType';
import { CheckboxField } from '../../fields/types/CheckboxField';
import { DateField } from '../../fields/types/DateField';
import { FormulaExpression } from '../../fields/types/FormulaExpression';
import { FormulaField } from '../../fields/types/FormulaField';
import { LinkField } from '../../fields/types/LinkField';
import { LinkFieldConfig } from '../../fields/types/LinkFieldConfig';
import { LongTextField } from '../../fields/types/LongTextField';
import { MultipleSelectField } from '../../fields/types/MultipleSelectField';
import { NumberField } from '../../fields/types/NumberField';
import { RatingField } from '../../fields/types/RatingField';
import { RollupExpression } from '../../fields/types/RollupExpression';
import { RollupField } from '../../fields/types/RollupField';
import { RollupFieldConfig } from '../../fields/types/RollupFieldConfig';
import { SelectOption } from '../../fields/types/SelectOption';
import { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import { SingleSelectField } from '../../fields/types/SingleSelectField';
import { UserField } from '../../fields/types/UserField';
import { UserMultiplicity } from '../../fields/types/UserMultiplicity';
import { TableId } from '../../TableId';
import { AttachmentConditionSpec } from './AttachmentConditionSpec';
import { ButtonConditionSpec } from './ButtonConditionSpec';
import { CheckboxConditionSpec } from './CheckboxConditionSpec';
import { DateConditionSpec } from './DateConditionSpec';
import { FormulaConditionSpec } from './FormulaConditionSpec';
import { LinkConditionSpec } from './LinkConditionSpec';
import { LongTextConditionSpec } from './LongTextConditionSpec';
import { MultipleSelectConditionSpec } from './MultipleSelectConditionSpec';
import { NumberConditionSpec } from './NumberConditionSpec';
import { RatingConditionSpec } from './RatingConditionSpec';
import {
  attachmentConditionOperatorSchema,
  booleanConditionOperatorSchema,
  dateConditionOperatorSchema,
  linkConditionOperatorSchema,
  multipleSelectConditionOperatorSchema,
  numberConditionOperatorSchema,
  recordConditionOperatorSchema,
  singleSelectConditionOperatorSchema,
  textConditionOperatorSchema,
  userConditionOperatorSchema,
} from './RecordConditionOperators';
import { RecordConditionLiteralValue } from './RecordConditionValues';
import { RollupConditionSpec } from './RollupConditionSpec';
import { SingleLineTextConditionSpec } from './SingleLineTextConditionSpec';
import { SingleSelectConditionSpec } from './SingleSelectConditionSpec';
import { UserConditionSpec } from './UserConditionSpec';
import { NoopRecordConditionSpecVisitor } from './visitors/NoopRecordConditionSpecVisitor';

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const selectOption = (name: string) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

const buildFields = () => {
  const textField = SingleLineTextField.create({
    id: fieldId('a'),
    name: fieldName('Text'),
  })._unsafeUnwrap();
  const longTextField = LongTextField.create({
    id: fieldId('b'),
    name: fieldName('LongText'),
  })._unsafeUnwrap();
  const buttonField = ButtonField.create({
    id: fieldId('c'),
    name: fieldName('Button'),
  })._unsafeUnwrap();
  const numberField = NumberField.create({
    id: fieldId('d'),
    name: fieldName('Number'),
  })._unsafeUnwrap();
  const ratingField = RatingField.create({
    id: fieldId('e'),
    name: fieldName('Rating'),
  })._unsafeUnwrap();
  const checkboxField = CheckboxField.create({
    id: fieldId('f'),
    name: fieldName('Checkbox'),
  })._unsafeUnwrap();
  const dateField = DateField.create({
    id: fieldId('g'),
    name: fieldName('Date'),
  })._unsafeUnwrap();
  const singleSelectField = SingleSelectField.create({
    id: fieldId('h'),
    name: fieldName('SingleSelect'),
    options: [selectOption('Open')],
  })._unsafeUnwrap();
  const multipleSelectField = MultipleSelectField.create({
    id: fieldId('i'),
    name: fieldName('MultipleSelect'),
    options: [selectOption('Alpha')],
  })._unsafeUnwrap();
  const attachmentField = AttachmentField.create({
    id: fieldId('j'),
    name: fieldName('Attachment'),
  })._unsafeUnwrap();
  const userField = UserField.create({
    id: fieldId('k'),
    name: fieldName('User'),
    isMultiple: UserMultiplicity.single(),
  })._unsafeUnwrap();
  const linkField = LinkField.create({
    id: fieldId('l'),
    name: fieldName('Link'),
    config: LinkFieldConfig.create({
      relationship: 'oneOne',
      foreignTableId: tableId('a').toString(),
      lookupFieldId: fieldId('m').toString(),
    })._unsafeUnwrap(),
  })._unsafeUnwrap();
  const formulaField = FormulaField.create({
    id: fieldId('n'),
    name: fieldName('Formula'),
    expression: FormulaExpression.create('1')._unsafeUnwrap(),
    resultType: {
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    },
  })._unsafeUnwrap();
  const rollupField = RollupField.rehydrate({
    id: fieldId('o'),
    name: fieldName('Rollup'),
    config: RollupFieldConfig.create({
      linkFieldId: fieldId('p').toString(),
      foreignTableId: tableId('b').toString(),
      lookupFieldId: fieldId('q').toString(),
    })._unsafeUnwrap(),
    expression: RollupExpression.default(),
    resultType: {
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    },
  })._unsafeUnwrap();

  return {
    textField,
    longTextField,
    buttonField,
    numberField,
    ratingField,
    checkboxField,
    dateField,
    singleSelectField,
    multipleSelectField,
    attachmentField,
    userField,
    linkField,
    formulaField,
    rollupField,
  };
};

describe('RecordConditionSpec accept', () => {
  it('routes all operators to visitor methods', () => {
    const fields = buildFields();
    const visitor = new NoopRecordConditionSpecVisitor();
    const value = RecordConditionLiteralValue.create('value')._unsafeUnwrap();

    for (const operator of textConditionOperatorSchema.options) {
      expect(
        SingleLineTextConditionSpec.create(fields.textField, operator, value).accept(visitor).isOk()
      ).toBe(true);
      expect(
        LongTextConditionSpec.create(fields.longTextField, operator, value).accept(visitor).isOk()
      ).toBe(true);
      expect(
        ButtonConditionSpec.create(fields.buttonField, operator, value).accept(visitor).isOk()
      ).toBe(true);
    }

    for (const operator of numberConditionOperatorSchema.options) {
      expect(
        NumberConditionSpec.create(fields.numberField, operator, value).accept(visitor).isOk()
      ).toBe(true);
      expect(
        RatingConditionSpec.create(fields.ratingField, operator, value).accept(visitor).isOk()
      ).toBe(true);
    }

    for (const operator of booleanConditionOperatorSchema.options) {
      expect(
        CheckboxConditionSpec.create(fields.checkboxField, operator, value).accept(visitor).isOk()
      ).toBe(true);
    }

    for (const operator of dateConditionOperatorSchema.options) {
      expect(
        DateConditionSpec.create(fields.dateField, operator, value).accept(visitor).isOk()
      ).toBe(true);
    }

    for (const operator of singleSelectConditionOperatorSchema.options) {
      expect(
        SingleSelectConditionSpec.create(fields.singleSelectField, operator, value)
          .accept(visitor)
          .isOk()
      ).toBe(true);
    }

    for (const operator of multipleSelectConditionOperatorSchema.options) {
      expect(
        MultipleSelectConditionSpec.create(fields.multipleSelectField, operator, value)
          .accept(visitor)
          .isOk()
      ).toBe(true);
    }

    for (const operator of attachmentConditionOperatorSchema.options) {
      expect(
        AttachmentConditionSpec.create(fields.attachmentField, operator, value)
          .accept(visitor)
          .isOk()
      ).toBe(true);
    }

    for (const operator of userConditionOperatorSchema.options) {
      expect(
        UserConditionSpec.create(fields.userField, operator, value).accept(visitor).isOk()
      ).toBe(true);
    }

    for (const operator of linkConditionOperatorSchema.options) {
      expect(
        LinkConditionSpec.create(fields.linkField, operator, value).accept(visitor).isOk()
      ).toBe(true);
    }

    for (const operator of recordConditionOperatorSchema.options) {
      expect(
        FormulaConditionSpec.create(fields.formulaField, operator, value).accept(visitor).isOk()
      ).toBe(true);
      expect(
        RollupConditionSpec.create(fields.rollupField, operator, value).accept(visitor).isOk()
      ).toBe(true);
    }
  });
});
