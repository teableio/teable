import { describe, expect, it } from 'vitest';

import type { Field } from '../../fields/Field';
import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { AttachmentField } from '../../fields/types/AttachmentField';
import { AutoNumberField } from '../../fields/types/AutoNumberField';
import { ButtonField } from '../../fields/types/ButtonField';
import { CellValueMultiplicity } from '../../fields/types/CellValueMultiplicity';
import { CellValueType } from '../../fields/types/CellValueType';
import { CheckboxField } from '../../fields/types/CheckboxField';
import { CreatedByField } from '../../fields/types/CreatedByField';
import { CreatedTimeField } from '../../fields/types/CreatedTimeField';
import { DateField } from '../../fields/types/DateField';
import { FormulaExpression } from '../../fields/types/FormulaExpression';
import { FormulaField } from '../../fields/types/FormulaField';
import { LastModifiedByField } from '../../fields/types/LastModifiedByField';
import { LastModifiedTimeField } from '../../fields/types/LastModifiedTimeField';
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
import { FieldValueTypeVisitor } from '../../fields/visitors/FieldValueTypeVisitor';
import { TableId } from '../../TableId';
import { RecordId } from '../RecordId';
import { TableRecord } from '../TableRecord';
import { TableRecordCellValue } from '../TableRecordFields';
import { AttachmentConditionSpec } from './AttachmentConditionSpec';
import { ButtonConditionSpec } from './ButtonConditionSpec';
import { CheckboxConditionSpec } from './CheckboxConditionSpec';
import { DateConditionSpec } from './DateConditionSpec';
import { FieldConditionSpecBuilder } from './FieldConditionSpecBuilder';
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
  getValidRecordConditionOperators,
  multipleSelectConditionOperatorSchema,
  numberConditionOperatorSchema,
  singleSelectConditionOperatorSchema,
  textConditionOperatorSchema,
  type RecordConditionOperator,
} from './RecordConditionOperators';
import { RecordConditionSpecBuilder } from './RecordConditionSpecBuilder';
import { createRecordConditionSpec } from './RecordConditionSpecFactory';
import {
  RecordConditionDateValue,
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
  type RecordConditionValue,
} from './RecordConditionValues';
import { RollupConditionSpec } from './RollupConditionSpec';
import { SingleLineTextConditionSpec } from './SingleLineTextConditionSpec';
import { SingleSelectConditionSpec } from './SingleSelectConditionSpec';
import { UserConditionSpec } from './UserConditionSpec';

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const cell = (value: unknown) => TableRecordCellValue.create(value)._unsafeUnwrap();
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
  const autoNumberField = AutoNumberField.create({
    id: fieldId('e'),
    name: fieldName('AutoNumber'),
  })._unsafeUnwrap();
  const ratingField = RatingField.create({
    id: fieldId('f'),
    name: fieldName('Rating'),
  })._unsafeUnwrap();
  const checkboxField = CheckboxField.create({
    id: fieldId('g'),
    name: fieldName('Checkbox'),
  })._unsafeUnwrap();
  const dateField = DateField.create({
    id: fieldId('h'),
    name: fieldName('Date'),
  })._unsafeUnwrap();
  const createdTimeField = CreatedTimeField.create({
    id: fieldId('i'),
    name: fieldName('CreatedTime'),
  })._unsafeUnwrap();
  const lastModifiedTimeField = LastModifiedTimeField.create({
    id: fieldId('j'),
    name: fieldName('LastModifiedTime'),
  })._unsafeUnwrap();
  const singleSelectField = SingleSelectField.create({
    id: fieldId('k'),
    name: fieldName('SingleSelect'),
    options: [selectOption('Open')],
  })._unsafeUnwrap();
  const multipleSelectField = MultipleSelectField.create({
    id: fieldId('l'),
    name: fieldName('MultipleSelect'),
    options: [selectOption('Alpha'), selectOption('Beta')],
  })._unsafeUnwrap();
  const attachmentField = AttachmentField.create({
    id: fieldId('m'),
    name: fieldName('Attachment'),
  })._unsafeUnwrap();
  const userSingleField = UserField.create({
    id: fieldId('n'),
    name: fieldName('UserSingle'),
    isMultiple: UserMultiplicity.single(),
  })._unsafeUnwrap();
  const userMultiField = UserField.create({
    id: fieldId('o'),
    name: fieldName('UserMulti'),
    isMultiple: UserMultiplicity.multiple(),
  })._unsafeUnwrap();
  const createdByField = CreatedByField.create({
    id: fieldId('p'),
    name: fieldName('CreatedBy'),
  })._unsafeUnwrap();
  const lastModifiedByField = LastModifiedByField.create({
    id: fieldId('q'),
    name: fieldName('LastModifiedBy'),
  })._unsafeUnwrap();
  const linkConfigSingle = LinkFieldConfig.create({
    relationship: 'oneOne',
    foreignTableId: tableId('a').toString(),
    lookupFieldId: fieldId('r').toString(),
  })._unsafeUnwrap();
  const linkConfigMulti = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: tableId('b').toString(),
    lookupFieldId: fieldId('s').toString(),
  })._unsafeUnwrap();
  const linkSingleField = LinkField.create({
    id: fieldId('r'),
    name: fieldName('LinkSingle'),
    config: linkConfigSingle,
  })._unsafeUnwrap();
  const linkMultiField = LinkField.create({
    id: fieldId('s'),
    name: fieldName('LinkMulti'),
    config: linkConfigMulti,
  })._unsafeUnwrap();
  const formulaField = FormulaField.create({
    id: fieldId('t'),
    name: fieldName('Formula'),
    expression: FormulaExpression.create('1')._unsafeUnwrap(),
    resultType: {
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    },
  })._unsafeUnwrap();
  const rollupField = RollupField.rehydrate({
    id: fieldId('u'),
    name: fieldName('Rollup'),
    config: RollupFieldConfig.create({
      linkFieldId: fieldId('v').toString(),
      foreignTableId: tableId('c').toString(),
      lookupFieldId: fieldId('w').toString(),
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
    autoNumberField,
    ratingField,
    checkboxField,
    dateField,
    createdTimeField,
    lastModifiedTimeField,
    singleSelectField,
    multipleSelectField,
    attachmentField,
    userSingleField,
    userMultiField,
    createdByField,
    lastModifiedByField,
    linkSingleField,
    linkMultiField,
    formulaField,
    rollupField,
  };
};

describe('RecordCondition operators', () => {
  it('matches valid operators by field type and value type', () => {
    const fields = buildFields();
    const textOperators = getValidRecordConditionOperators(
      fields.textField,
      fields.textField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(textOperators).toEqual(textConditionOperatorSchema.options);

    const numberOperators = getValidRecordConditionOperators(
      fields.numberField,
      fields.numberField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(numberOperators).toEqual(numberConditionOperatorSchema.options);

    const booleanOperators = getValidRecordConditionOperators(
      fields.checkboxField,
      fields.checkboxField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(booleanOperators).toEqual(booleanConditionOperatorSchema.options);

    const dateOperators = getValidRecordConditionOperators(
      fields.dateField,
      fields.dateField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(dateOperators).toEqual(dateConditionOperatorSchema.options);

    const singleSelectOperators = getValidRecordConditionOperators(
      fields.singleSelectField,
      fields.singleSelectField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(singleSelectOperators).toEqual(singleSelectConditionOperatorSchema.options);

    const multipleSelectOperators = getValidRecordConditionOperators(
      fields.multipleSelectField,
      fields.multipleSelectField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(multipleSelectOperators).toEqual(multipleSelectConditionOperatorSchema.options);

    const userSingleOperators = getValidRecordConditionOperators(
      fields.userSingleField,
      fields.userSingleField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(userSingleOperators).toEqual([
      'is',
      'isNot',
      'isAnyOf',
      'isNoneOf',
      'isEmpty',
      'isNotEmpty',
    ]);

    const userMultiOperators = getValidRecordConditionOperators(
      fields.userMultiField,
      fields.userMultiField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(userMultiOperators).toEqual([
      'hasAnyOf',
      'hasAllOf',
      'isExactly',
      'hasNoneOf',
      'isNotExactly',
      'isEmpty',
      'isNotEmpty',
    ]);

    const linkSingleOperators = getValidRecordConditionOperators(
      fields.linkSingleField,
      fields.linkSingleField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(linkSingleOperators).toEqual([
      'is',
      'isNot',
      'isAnyOf',
      'isNoneOf',
      'contains',
      'doesNotContain',
      'isEmpty',
      'isNotEmpty',
    ]);

    const linkMultiOperators = getValidRecordConditionOperators(
      fields.linkMultiField,
      fields.linkMultiField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(linkMultiOperators).toEqual([
      'hasAnyOf',
      'hasAllOf',
      'isExactly',
      'hasNoneOf',
      'isNotExactly',
      'contains',
      'doesNotContain',
      'isEmpty',
      'isNotEmpty',
    ]);

    const attachmentOperators = getValidRecordConditionOperators(
      fields.attachmentField,
      fields.attachmentField.accept(new FieldValueTypeVisitor())._unsafeUnwrap()
    );
    expect(attachmentOperators).toEqual(attachmentConditionOperatorSchema.options);
  });

  it('returns multipleSelect operators for singleSelect with isMultiple (v1 compatibility)', () => {
    const fields = buildFields();

    // When a singleSelect field has isMultipleCellValue (e.g., from lookup/rollup),
    // it should support multipleSelect operators like hasAnyOf, hasAllOf, etc.
    // This is required for v1 compatibility where singleSelect with isMultipleCellValue
    // can use operators like hasAnyOf.
    const singleSelectMultipleValueType = {
      cellValueType: CellValueType.string(),
      isMultipleCellValue: CellValueMultiplicity.multiple(),
    };

    const operators = getValidRecordConditionOperators(
      fields.singleSelectField,
      singleSelectMultipleValueType
    );

    expect(operators).toEqual(multipleSelectConditionOperatorSchema.options);
    expect(operators).toContain('hasAnyOf');
    expect(operators).toContain('hasAllOf');
    expect(operators).toContain('isExactly');
    expect(operators).toContain('isNotExactly');
    expect(operators).toContain('hasNoneOf');
  });
});

describe('FieldConditionSpecBuilder', () => {
  it('creates spec types per field', () => {
    const fields = buildFields();
    const textValue = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
    const numberValue = RecordConditionLiteralValue.create(3)._unsafeUnwrap();
    const listValue = RecordConditionLiteralListValue.create(['Open'])._unsafeUnwrap();
    const dateValue = RecordConditionDateValue.create({
      mode: 'exactDate',
      exactDate: '2024-01-02T00:00:00.000Z',
      timeZone: 'utc',
    })._unsafeUnwrap();

    const cases: Array<{
      field: Field;
      operator: RecordConditionOperator;
      value?: RecordConditionValue;
      assert: (spec: unknown) => void;
    }> = [
      {
        field: fields.textField,
        operator: 'contains',
        value: textValue,
        assert: (spec) => expect(spec).toBeInstanceOf(SingleLineTextConditionSpec),
      },
      {
        field: fields.longTextField,
        operator: 'contains',
        value: textValue,
        assert: (spec) => expect(spec).toBeInstanceOf(LongTextConditionSpec),
      },
      {
        field: fields.buttonField,
        operator: 'is',
        value: textValue,
        assert: (spec) => expect(spec).toBeInstanceOf(ButtonConditionSpec),
      },
      {
        field: fields.numberField,
        operator: 'isGreater',
        value: numberValue,
        assert: (spec) => expect(spec).toBeInstanceOf(NumberConditionSpec),
      },
      {
        field: fields.autoNumberField,
        operator: 'isLess',
        value: numberValue,
        assert: (spec) => expect(spec).toBeInstanceOf(NumberConditionSpec),
      },
      {
        field: fields.ratingField,
        operator: 'isGreaterEqual',
        value: numberValue,
        assert: (spec) => expect(spec).toBeInstanceOf(RatingConditionSpec),
      },
      {
        field: fields.checkboxField,
        operator: 'is',
        value: RecordConditionLiteralValue.create(true)._unsafeUnwrap(),
        assert: (spec) => expect(spec).toBeInstanceOf(CheckboxConditionSpec),
      },
      {
        field: fields.dateField,
        operator: 'isAfter',
        value: dateValue,
        assert: (spec) => expect(spec).toBeInstanceOf(DateConditionSpec),
      },
      {
        field: fields.createdTimeField,
        operator: 'isAfter',
        value: dateValue,
        assert: (spec) => expect(spec).toBeInstanceOf(DateConditionSpec),
      },
      {
        field: fields.lastModifiedTimeField,
        operator: 'isBefore',
        value: dateValue,
        assert: (spec) => expect(spec).toBeInstanceOf(DateConditionSpec),
      },
      {
        field: fields.singleSelectField,
        operator: 'isAnyOf',
        value: listValue,
        assert: (spec) => expect(spec).toBeInstanceOf(SingleSelectConditionSpec),
      },
      {
        field: fields.multipleSelectField,
        operator: 'hasAllOf',
        value: listValue,
        assert: (spec) => expect(spec).toBeInstanceOf(MultipleSelectConditionSpec),
      },
      {
        field: fields.attachmentField,
        operator: 'isEmpty',
        assert: (spec) => expect(spec).toBeInstanceOf(AttachmentConditionSpec),
      },
      {
        field: fields.userSingleField,
        operator: 'isAnyOf',
        value: listValue,
        assert: (spec) => expect(spec).toBeInstanceOf(UserConditionSpec),
      },
      {
        field: fields.userMultiField,
        operator: 'hasAnyOf',
        value: listValue,
        assert: (spec) => expect(spec).toBeInstanceOf(UserConditionSpec),
      },
      {
        field: fields.createdByField,
        operator: 'is',
        value: textValue,
        assert: (spec) => expect(spec).toBeInstanceOf(UserConditionSpec),
      },
      {
        field: fields.lastModifiedByField,
        operator: 'isNot',
        value: textValue,
        assert: (spec) => expect(spec).toBeInstanceOf(UserConditionSpec),
      },
      {
        field: fields.linkSingleField,
        operator: 'contains',
        value: textValue,
        assert: (spec) => expect(spec).toBeInstanceOf(LinkConditionSpec),
      },
      {
        field: fields.linkMultiField,
        operator: 'hasAnyOf',
        value: listValue,
        assert: (spec) => expect(spec).toBeInstanceOf(LinkConditionSpec),
      },
      {
        field: fields.formulaField,
        operator: 'is',
        value: textValue,
        assert: (spec) => expect(spec).toBeInstanceOf(FormulaConditionSpec),
      },
      {
        field: fields.rollupField,
        operator: 'isGreater',
        value: numberValue,
        assert: (spec) => expect(spec).toBeInstanceOf(RollupConditionSpec),
      },
    ];

    for (const entry of cases) {
      const result = FieldConditionSpecBuilder.create(entry.field).create({
        operator: entry.operator,
        value: entry.value,
      });
      expect(result.isOk()).toBe(true);
      entry.assert(result._unsafeUnwrap());
    }

    const referenceValue = RecordConditionFieldReferenceValue.create(
      fields.singleSelectField
    )._unsafeUnwrap();
    const referenceResult = FieldConditionSpecBuilder.create(fields.singleSelectField).create({
      operator: 'isAnyOf',
      value: referenceValue,
    });
    expect(referenceResult.isOk()).toBe(true);
  });

  it('rejects invalid operator/value combinations', () => {
    const fields = buildFields();
    const textValue = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
    const listValue = RecordConditionLiteralListValue.create(['Open'])._unsafeUnwrap();

    const invalidOperator = FieldConditionSpecBuilder.create(fields.textField).create({
      operator: 'isGreater',
      value: RecordConditionLiteralValue.create(1)._unsafeUnwrap(),
    });
    expect(invalidOperator._unsafeUnwrapErr().message).toContain(
      'Invalid record condition operator for field'
    );

    const missingValue = FieldConditionSpecBuilder.create(fields.textField).create({
      operator: 'is',
    });
    expect(missingValue._unsafeUnwrapErr().message).toContain('Record condition requires a value');

    const expectsNull = FieldConditionSpecBuilder.create(fields.textField).create({
      operator: 'isEmpty',
      value: textValue,
    });
    expect(expectsNull._unsafeUnwrapErr().message).toContain('Record condition expects null value');

    const expectsArray = FieldConditionSpecBuilder.create(fields.singleSelectField).create({
      operator: 'isAnyOf',
      value: textValue,
    });
    expect(expectsArray._unsafeUnwrapErr().message).toContain(
      'Record condition requires list value'
    );

    const disallowArray = FieldConditionSpecBuilder.create(fields.textField).create({
      operator: 'contains',
      value: listValue,
    });
    expect(disallowArray._unsafeUnwrapErr().message).toContain(
      'Record condition does not allow list value'
    );
  });
});

describe('RecordConditionSpecBuilder', () => {
  it('builds grouped and inverted specs', () => {
    const fields = buildFields();
    const record = TableRecord.create({
      id: recordId('z'),
      tableId: tableId('z'),
      fieldValues: [
        { fieldId: fields.textField.id(), value: cell('hello world') },
        { fieldId: fields.numberField.id(), value: cell(5) },
      ],
    })._unsafeUnwrap();

    const builder = RecordConditionSpecBuilder.create('and');
    builder.addCondition({
      field: fields.textField,
      operator: 'contains',
      value: RecordConditionLiteralValue.create('hello')._unsafeUnwrap(),
    });
    builder.andGroup((group) =>
      group
        .addCondition({
          field: fields.numberField,
          operator: 'isGreaterEqual',
          value: RecordConditionLiteralValue.create(5)._unsafeUnwrap(),
        })
        .addCondition({
          field: fields.textField,
          operator: 'contains',
          value: RecordConditionLiteralValue.create('world')._unsafeUnwrap(),
        })
    );
    builder.orGroup((group) =>
      group
        .addCondition({
          field: fields.textField,
          operator: 'contains',
          value: RecordConditionLiteralValue.create('hello')._unsafeUnwrap(),
        })
        .addCondition({
          field: fields.textField,
          operator: 'contains',
          value: RecordConditionLiteralValue.create('nope')._unsafeUnwrap(),
        })
    );
    const spec = builder.build()._unsafeUnwrap();
    expect(spec.isSatisfiedBy(record)).toBe(true);

    const directSpec = SingleLineTextConditionSpec.create(
      fields.textField,
      'contains',
      RecordConditionLiteralValue.create('hello')._unsafeUnwrap()
    );
    const directBuilder = RecordConditionSpecBuilder.create();
    directBuilder.addConditionSpec(directSpec);
    const directResult = directBuilder.build()._unsafeUnwrap();
    expect(directResult.isSatisfiedBy(record)).toBe(true);

    const notBuilder = RecordConditionSpecBuilder.create();
    notBuilder.not((child) =>
      child.addCondition({
        field: fields.textField,
        operator: 'contains',
        value: RecordConditionLiteralValue.create('hello')._unsafeUnwrap(),
      })
    );
    const notSpec = notBuilder.build()._unsafeUnwrap();
    expect(notSpec.isSatisfiedBy(record)).toBe(false);
  });

  it('returns errors for invalid conditions', () => {
    const fields = buildFields();
    const builder = RecordConditionSpecBuilder.create();
    builder.addCondition({
      field: fields.textField,
      operator: 'isGreater',
      value: RecordConditionLiteralValue.create(1)._unsafeUnwrap(),
    });
    const result = builder.build();
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain(
      'Invalid record condition operator for field'
    );
  });
});

describe('RecordConditionSpecFactory', () => {
  it('creates condition specs via field factories', () => {
    const fields = buildFields();
    const result = createRecordConditionSpec({
      field: fields.textField,
      operator: 'contains',
      value: RecordConditionLiteralValue.create('hello')._unsafeUnwrap(),
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(SingleLineTextConditionSpec);

    const invalid = createRecordConditionSpec({
      field: fields.textField,
      operator: 'isGreater',
      value: RecordConditionLiteralValue.create(1)._unsafeUnwrap(),
    });
    expect(invalid._unsafeUnwrapErr().message).toContain(
      'Invalid record condition operator for field'
    );
  });
});
