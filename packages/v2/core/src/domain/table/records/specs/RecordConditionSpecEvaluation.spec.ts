import { describe, expect, it } from 'vitest';

import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { CheckboxField } from '../../fields/types/CheckboxField';
import { DateField } from '../../fields/types/DateField';
import { MultipleSelectField } from '../../fields/types/MultipleSelectField';
import { NumberField } from '../../fields/types/NumberField';
import { SelectOption } from '../../fields/types/SelectOption';
import { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import { SingleSelectField } from '../../fields/types/SingleSelectField';
import { TableId } from '../../TableId';
import { RecordId } from '../RecordId';
import { TableRecord } from '../TableRecord';
import { TableRecordCellValue } from '../TableRecordFields';
import { DateConditionSpec } from './DateConditionSpec';
import { FormulaConditionSpec } from './FormulaConditionSpec';
import { MultipleSelectConditionSpec } from './MultipleSelectConditionSpec';
import { NumberConditionSpec } from './NumberConditionSpec';
import {
  RecordConditionDateValue,
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
} from './RecordConditionValues';
import { SingleLineTextConditionSpec } from './SingleLineTextConditionSpec';
import { SingleSelectConditionSpec } from './SingleSelectConditionSpec';

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const cell = (value: unknown) => TableRecordCellValue.create(value)._unsafeUnwrap();

const buildSelectOption = (name: string) =>
  SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

const buildBaseRecord = () => {
  const textField = SingleLineTextField.create({
    id: fieldId('a'),
    name: fieldName('Text'),
  })._unsafeUnwrap();
  const numberField = NumberField.create({
    id: fieldId('b'),
    name: fieldName('Number'),
  })._unsafeUnwrap();
  const dateField = DateField.create({
    id: fieldId('c'),
    name: fieldName('Date'),
  })._unsafeUnwrap();
  const singleSelectField = SingleSelectField.create({
    id: fieldId('d'),
    name: fieldName('Status'),
    options: [buildSelectOption('Open')],
  })._unsafeUnwrap();
  const multipleSelectField = MultipleSelectField.create({
    id: fieldId('e'),
    name: fieldName('Tags'),
    options: [buildSelectOption('Alpha'), buildSelectOption('Beta')],
  })._unsafeUnwrap();
  const emptyStringField = SingleLineTextField.create({
    id: fieldId('f'),
    name: fieldName('EmptyText'),
  })._unsafeUnwrap();
  const emptyArrayField = MultipleSelectField.create({
    id: fieldId('g'),
    name: fieldName('EmptyList'),
    options: [buildSelectOption('X')],
  })._unsafeUnwrap();
  const objectField = SingleLineTextField.create({
    id: fieldId('h'),
    name: fieldName('Object'),
  })._unsafeUnwrap();
  const referenceField = SingleLineTextField.create({
    id: fieldId('i'),
    name: fieldName('Ref'),
  })._unsafeUnwrap();
  const referenceTargetField = SingleLineTextField.create({
    id: fieldId('j'),
    name: fieldName('RefTarget'),
  })._unsafeUnwrap();
  const referenceListField = MultipleSelectField.create({
    id: fieldId('k'),
    name: fieldName('RefList'),
    options: [buildSelectOption('Alpha')],
  })._unsafeUnwrap();
  const checkboxField = CheckboxField.create({
    id: fieldId('l'),
    name: fieldName('Flag'),
  })._unsafeUnwrap();

  const record = TableRecord.create({
    id: recordId('a'),
    tableId: tableId('a'),
    fieldValues: [
      { fieldId: textField.id(), value: cell('hello world') },
      { fieldId: numberField.id(), value: cell(10) },
      { fieldId: dateField.id(), value: cell('2024-01-02T00:00:00.000Z') },
      { fieldId: singleSelectField.id(), value: cell('Open') },
      { fieldId: multipleSelectField.id(), value: cell(['Alpha', 'Beta']) },
      { fieldId: emptyStringField.id(), value: cell('') },
      { fieldId: emptyArrayField.id(), value: cell([]) },
      { fieldId: objectField.id(), value: cell({ value: 1 }) },
      { fieldId: referenceField.id(), value: cell('match') },
      { fieldId: referenceTargetField.id(), value: cell('match') },
      { fieldId: referenceListField.id(), value: cell(['Alpha', 'Beta']) },
      { fieldId: checkboxField.id(), value: cell(true) },
    ],
  })._unsafeUnwrap();

  return {
    record,
    textField,
    numberField,
    dateField,
    singleSelectField,
    multipleSelectField,
    emptyStringField,
    emptyArrayField,
    objectField,
    referenceField,
    referenceTargetField,
    referenceListField,
    checkboxField,
  };
};

describe('RecordConditionSpec evaluation', () => {
  it('evaluates string and number operators', () => {
    const { record, textField, numberField } = buildBaseRecord();
    const contains = SingleLineTextConditionSpec.create(
      textField,
      'contains',
      RecordConditionLiteralValue.create('hello')._unsafeUnwrap()
    );
    const doesNotContain = SingleLineTextConditionSpec.create(
      textField,
      'doesNotContain',
      RecordConditionLiteralValue.create('nope')._unsafeUnwrap()
    );
    const isNot = SingleLineTextConditionSpec.create(
      textField,
      'isNot',
      RecordConditionLiteralValue.create('nope')._unsafeUnwrap()
    );
    const isGreater = NumberConditionSpec.create(
      numberField,
      'isGreater',
      RecordConditionLiteralValue.create(5)._unsafeUnwrap()
    );
    const isLessEqual = NumberConditionSpec.create(
      numberField,
      'isLessEqual',
      RecordConditionLiteralValue.create(10)._unsafeUnwrap()
    );

    expect(contains.isSatisfiedBy(record)).toBe(true);
    expect(doesNotContain.isSatisfiedBy(record)).toBe(true);
    expect(isNot.isSatisfiedBy(record)).toBe(true);
    expect(isGreater.isSatisfiedBy(record)).toBe(true);
    expect(isLessEqual.isSatisfiedBy(record)).toBe(true);

    const badRecord = TableRecord.create({
      id: recordId('b'),
      tableId: tableId('a'),
      fieldValues: [{ fieldId: numberField.id(), value: cell('ten') }],
    })._unsafeUnwrap();
    expect(isGreater.isSatisfiedBy(badRecord)).toBe(false);
  });

  it('evaluates date operators with literal and date values', () => {
    const { record, dateField } = buildBaseRecord();
    const before = DateConditionSpec.create(
      dateField,
      'isBefore',
      RecordConditionLiteralValue.create('2024-01-03T00:00:00.000Z')._unsafeUnwrap()
    );
    const exactDate = RecordConditionDateValue.create({
      mode: 'exactDate',
      exactDate: '2024-01-02T00:00:00.000Z',
      timeZone: 'utc',
    })._unsafeUnwrap();
    const exact = DateConditionSpec.create(dateField, 'is', exactDate);

    expect(before.isSatisfiedBy(record)).toBe(true);
    expect(exact.isSatisfiedBy(record)).toBe(true);

    const missingExact = RecordConditionDateValue.create({
      mode: 'today',
      timeZone: 'utc',
    })._unsafeUnwrap();
    const missingExactSpec = DateConditionSpec.create(dateField, 'is', missingExact);
    expect(missingExactSpec.isSatisfiedBy(record)).toBe(false);

    const badRecord = TableRecord.create({
      id: recordId('c'),
      tableId: tableId('a'),
      fieldValues: [{ fieldId: dateField.id(), value: cell('not-a-date') }],
    })._unsafeUnwrap();
    expect(before.isSatisfiedBy(badRecord)).toBe(false);
  });

  it('evaluates array operators with list and scalar values', () => {
    const { record, multipleSelectField, singleSelectField } = buildBaseRecord();
    const hasAny = MultipleSelectConditionSpec.create(
      multipleSelectField,
      'hasAnyOf',
      RecordConditionLiteralListValue.create(['Beta', 'Gamma'])._unsafeUnwrap()
    );
    const hasAll = MultipleSelectConditionSpec.create(
      multipleSelectField,
      'hasAllOf',
      RecordConditionLiteralListValue.create(['Alpha', 'Beta'])._unsafeUnwrap()
    );
    const isExactly = MultipleSelectConditionSpec.create(
      multipleSelectField,
      'isExactly',
      RecordConditionLiteralListValue.create(['Beta', 'Alpha'])._unsafeUnwrap()
    );
    const isNotExactly = MultipleSelectConditionSpec.create(
      multipleSelectField,
      'isNotExactly',
      RecordConditionLiteralListValue.create(['Alpha'])._unsafeUnwrap()
    );
    const hasNone = MultipleSelectConditionSpec.create(
      multipleSelectField,
      'hasNoneOf',
      RecordConditionLiteralListValue.create(['Gamma'])._unsafeUnwrap()
    );

    expect(hasAny.isSatisfiedBy(record)).toBe(true);
    expect(hasAll.isSatisfiedBy(record)).toBe(true);
    expect(isExactly.isSatisfiedBy(record)).toBe(true);
    expect(isNotExactly.isSatisfiedBy(record)).toBe(true);
    expect(hasNone.isSatisfiedBy(record)).toBe(true);

    const isAnyOf = SingleSelectConditionSpec.create(
      singleSelectField,
      'isAnyOf',
      RecordConditionLiteralListValue.create(['Open', 'Closed'])._unsafeUnwrap()
    );
    const isNoneOf = SingleSelectConditionSpec.create(
      singleSelectField,
      'isNoneOf',
      RecordConditionLiteralListValue.create(['Closed'])._unsafeUnwrap()
    );
    expect(isAnyOf.isSatisfiedBy(record)).toBe(true);
    expect(isNoneOf.isSatisfiedBy(record)).toBe(true);

    const badRecord = TableRecord.create({
      id: recordId('d'),
      tableId: tableId('a'),
      fieldValues: [{ fieldId: multipleSelectField.id(), value: cell({ value: 1 }) }],
    })._unsafeUnwrap();
    expect(hasAny.isSatisfiedBy(badRecord)).toBe(false);
  });

  it('handles empty operators and missing values', () => {
    const { record, emptyStringField, emptyArrayField } = buildBaseRecord();
    const missingField = SingleLineTextField.create({
      id: fieldId('m'),
      name: fieldName('Missing'),
    })._unsafeUnwrap();

    const emptyText = SingleLineTextConditionSpec.create(emptyStringField, 'isEmpty');
    const notEmptyText = SingleLineTextConditionSpec.create(emptyStringField, 'isNotEmpty');
    const emptyList = MultipleSelectConditionSpec.create(emptyArrayField, 'isEmpty');
    const missingEmpty = SingleLineTextConditionSpec.create(missingField, 'isEmpty');
    const missingNotEmpty = SingleLineTextConditionSpec.create(missingField, 'isNotEmpty');

    expect(emptyText.isSatisfiedBy(record)).toBe(true);
    expect(notEmptyText.isSatisfiedBy(record)).toBe(false);
    expect(emptyList.isSatisfiedBy(record)).toBe(true);
    expect(missingEmpty.isSatisfiedBy(record)).toBe(true);
    expect(missingNotEmpty.isSatisfiedBy(record)).toBe(false);

    const requiresValue = SingleLineTextConditionSpec.create(emptyStringField, 'contains');
    expect(requiresValue.isSatisfiedBy(record)).toBe(false);
  });

  it('resolves field reference values', () => {
    const {
      record,
      referenceField,
      referenceTargetField,
      multipleSelectField,
      referenceListField,
      objectField,
    } = buildBaseRecord();
    const referenceValue =
      RecordConditionFieldReferenceValue.create(referenceTargetField)._unsafeUnwrap();
    const referenceSpec = SingleLineTextConditionSpec.create(referenceField, 'is', referenceValue);
    expect(referenceSpec.isSatisfiedBy(record)).toBe(true);

    const listReference =
      RecordConditionFieldReferenceValue.create(referenceListField)._unsafeUnwrap();
    const listSpec = MultipleSelectConditionSpec.create(
      multipleSelectField,
      'isExactly',
      listReference
    );
    expect(listSpec.isSatisfiedBy(record)).toBe(true);

    const invalidReference = RecordConditionFieldReferenceValue.create(objectField)._unsafeUnwrap();
    const invalidSpec = SingleLineTextConditionSpec.create(referenceField, 'is', invalidReference);
    expect(invalidSpec.isSatisfiedBy(record)).toBe(false);
  });

  it('returns false for unsupported operators and still mutates ok', () => {
    const { record, checkboxField } = buildBaseRecord();
    const spec = FormulaConditionSpec.create(
      checkboxField,
      'isWithIn',
      RecordConditionLiteralValue.create(true)._unsafeUnwrap()
    );
    expect(spec.isSatisfiedBy(record)).toBe(false);
    expect(spec.mutate(record).isOk()).toBe(true);
  });
});
