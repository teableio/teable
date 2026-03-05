import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { UpdateSingleSelectOptionsSpec } from '../../specs/field-updates/UpdateSingleSelectOptionsSpec';
import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { DbFieldName } from '../DbFieldName';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { ConditionalLookupField } from './ConditionalLookupField';
import { ConditionalLookupOptions } from './ConditionalLookupOptions';
import { FormulaExpression } from './FormulaExpression';
import { FormulaField } from './FormulaField';
import { SelectOption } from './SelectOption';
import { SingleLineTextField } from './SingleLineTextField';
import { SingleSelectField } from './SingleSelectField';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();

const createConditionalLookupField = (statusFieldId: FieldId) => {
  const lookupOptions = ConditionalLookupOptions.create({
    foreignTableId: createTableId('z').toString(),
    lookupFieldId: createFieldId('y').toString(),
    condition: {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
      },
    },
  })._unsafeUnwrap();

  return ConditionalLookupField.create({
    id: createFieldId('x'),
    name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
    innerField: SingleLineTextField.create({
      id: createFieldId('w'),
      name: FieldName.create('Title')._unsafeUnwrap(),
    })._unsafeUnwrap(),
    conditionalLookupOptions: lookupOptions,
  })._unsafeUnwrap();
};

describe('ConditionalLookupField.onDependencyUpdated', () => {
  it('keeps explicit inner field type when validating foreign tables', () => {
    const baseId = createBaseId('n');
    const hostTableId = createTableId('o');
    const foreignTableId = createTableId('p');
    const hostPrimaryId = createFieldId('q');
    const hostStatusId = createFieldId('r');
    const foreignPrimaryId = createFieldId('s');
    const foreignDateFieldId = createFieldId('t');

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .date()
      .withId(foreignDateFieldId)
      .withName(FieldName.create('Due Date')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withId(hostTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostStatusId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const innerFormulaField = FormulaField.create({
      id: createFieldId('u'),
      name: FieldName.create('Inner Formula')._unsafeUnwrap(),
      expression: FormulaExpression.create('NOW()')._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();

    const conditionalLookup = ConditionalLookupField.create({
      id: createFieldId('v'),
      name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
      innerField: innerFormulaField,
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignDateFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: hostStatusId.toString(), operator: 'is', value: 'Active' }],
          },
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const validationResult = conditionalLookup.validateForeignTables({
      hostTable,
      foreignTables: [foreignTable],
    });

    expect(validationResult.isOk()).toBe(true);
    expect(conditionalLookup.innerField()._unsafeUnwrap()).toBeInstanceOf(FormulaField);
    expect(conditionalLookup.innerFieldType()._unsafeUnwrap().toString()).toBe('formula');
  });

  it('preserves inner options patch when duplicated', () => {
    const statusFieldId = createFieldId('z');
    const field = ConditionalLookupField.create({
      id: createFieldId('y'),
      name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
      innerField: SingleLineTextField.create({
        id: createFieldId('x'),
        name: FieldName.create('Title')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: createTableId('w').toString(),
        lookupFieldId: createFieldId('v').toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
          },
        },
      })._unsafeUnwrap(),
      innerOptionsPatch: {
        formatting: {
          type: 'currency',
          precision: 1,
          symbol: '¥',
        },
      },
    })._unsafeUnwrap();

    const duplicated = field
      .duplicate({
        newId: createFieldId('u'),
        newName: FieldName.create('Conditional Lookup Copy')._unsafeUnwrap(),
        baseId: createBaseId('b'),
        tableId: createTableId('t'),
      })
      ._unsafeUnwrap() as ConditionalLookupField;

    expect(duplicated.innerOptionsPatch()).toEqual({
      formatting: {
        type: 'currency',
        precision: 1,
        symbol: '¥',
      },
    });
  });

  it('marks hasError when referenced field is type-converted', () => {
    const statusFieldId = createFieldId('a');
    const conditionalLookup = createConditionalLookupField(statusFieldId);
    const updatedField = SingleSelectField.create({
      id: statusFieldId,
      name: FieldName.create('Status')._unsafeUnwrap(),
      options: [
        SelectOption.create({ id: 'cho_a', name: 'Active', color: 'green' })._unsafeUnwrap(),
      ],
    })._unsafeUnwrap();
    const convertedField = SingleLineTextField.create({
      id: statusFieldId,
      name: FieldName.create('Status')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const typeSpec = TableUpdateFieldTypeSpec.create(updatedField, convertedField);

    const result = conditionalLookup.onDependencyUpdated(updatedField, [typeSpec], {} as never);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
  });

  it('emits field type update when referenced select option name changes', () => {
    const statusFieldId = createFieldId('b');
    const conditionalLookup = createConditionalLookupField(statusFieldId);
    const statusField = SingleSelectField.create({
      id: statusFieldId,
      name: FieldName.create('Status')._unsafeUnwrap(),
      options: [
        SelectOption.create({ id: 'cho_active', name: 'Active', color: 'green' })._unsafeUnwrap(),
        SelectOption.create({ id: 'cho_closed', name: 'Closed', color: 'red' })._unsafeUnwrap(),
      ],
    })._unsafeUnwrap();

    const optionsSpec = UpdateSingleSelectOptionsSpec.create(
      statusFieldId,
      DbFieldName.rehydrate('status')._unsafeUnwrap(),
      statusField.selectOptions(),
      [
        SelectOption.create({
          id: 'cho_active',
          name: 'Active Plus',
          color: 'green',
        })._unsafeUnwrap(),
        SelectOption.create({ id: 'cho_closed', name: 'Closed', color: 'red' })._unsafeUnwrap(),
      ]
    );

    const result = conditionalLookup.onDependencyUpdated(statusField, [optionsSpec], {} as never);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldTypeSpec);

    const spec = result._unsafeUnwrap() as TableUpdateFieldTypeSpec;
    const nextField = spec.newField() as ConditionalLookupField;
    const nextFilter = nextField.conditionalLookupOptions().condition().toDto().filter as {
      filterSet: Array<{ value?: unknown }>;
    };
    expect(nextFilter.filterSet[0]?.value).toBe('Active Plus');
  });

  it('marks hasError when value-referenced field is type-converted', () => {
    const foreignStatusFieldId = createFieldId('c');
    const hostStatusFieldId = createFieldId('d');
    const conditionalLookup = ConditionalLookupField.create({
      id: createFieldId('e'),
      name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
      innerField: SingleLineTextField.create({
        id: createFieldId('f'),
        name: FieldName.create('Title')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: createTableId('g').toString(),
        lookupFieldId: createFieldId('h').toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: foreignStatusFieldId.toString(),
                operator: 'is',
                value: { type: 'field', fieldId: hostStatusFieldId.toString() },
              },
            ],
          },
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const updatedField = SingleSelectField.create({
      id: hostStatusFieldId,
      name: FieldName.create('Host Status')._unsafeUnwrap(),
      options: [
        SelectOption.create({ id: 'cho_a', name: 'Active', color: 'green' })._unsafeUnwrap(),
      ],
    })._unsafeUnwrap();
    const convertedField = SingleLineTextField.create({
      id: hostStatusFieldId,
      name: FieldName.create('Host Status')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const typeSpec = TableUpdateFieldTypeSpec.create(updatedField, convertedField);

    const result = conditionalLookup.onDependencyUpdated(updatedField, [typeSpec], {} as never);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
  });
});
