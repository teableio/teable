import { ok } from 'neverthrow';
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
import { FieldHasError } from './FieldHasError';
import { FormulaExpression } from './FormulaExpression';
import { FormulaField } from './FormulaField';
import { LongTextField } from './LongTextField';
import { SelectOption } from './SelectOption';
import { SingleLineTextField } from './SingleLineTextField';
import { SingleSelectField } from './SingleSelectField';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createSelectOptions = (options: ReadonlyArray<{ id: string; name: string; color: string }>) =>
  options.map((option) => SelectOption.create(option)._unsafeUnwrap());

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

describe('ConditionalLookupField foreign target option sync', () => {
  it('derives select options from the foreign target during pending validation', () => {
    const baseId = createBaseId('0');
    const hostTableId = createTableId('1');
    const foreignTableId = createTableId('2');
    const hostPrimaryId = createFieldId('3');
    const hostStatusId = createFieldId('4');
    const foreignPrimaryId = createFieldId('5');
    const foreignLookupFieldId = createFieldId('6');
    const expectedOptions = createSelectOptions([
      { id: 'cho_core', name: 'Core', color: 'blueBright' },
      { id: 'cho_important', name: 'Important', color: 'greenBright' },
      { id: 'cho_reference', name: 'Reference', color: 'orangeBright' },
    ]);

    const hostBuilder = Table.builder()
      .withId(hostTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
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

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleSelect()
      .withId(foreignLookupFieldId)
      .withName(FieldName.create('Importance')._unsafeUnwrap())
      .withOptions(expectedOptions)
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const field = ConditionalLookupField.createPending({
      id: createFieldId('7'),
      name: FieldName.create('Importance Lookup')._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignLookupFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: hostStatusId.toString(), operator: 'is', value: 'Active' }],
          },
        },
      })._unsafeUnwrap(),
      innerOptionsPatch: {
        choices: [
          { id: 'cho_broken_1', name: 'Option 1', color: 'blueBright' },
          { id: 'cho_broken_2', name: 'Option 2', color: 'greenBright' },
        ],
      },
    })._unsafeUnwrap();

    field
      .validateForeignTables({
        hostTable,
        foreignTables: [foreignTable],
      })
      ._unsafeUnwrap();

    expect(field.innerOptionsPatch()).toBeUndefined();
    const innerField = field.innerField()._unsafeUnwrap() as SingleSelectField;
    expect(innerField.selectOptions().map((option) => option.toDto())).toEqual(
      expectedOptions.map((option) => option.toDto())
    );
  });

  it('rebuilds duplicated select-backed lookup fields from the foreign target', () => {
    const baseId = createBaseId('8');
    const hostTableId = createTableId('9');
    const foreignTableId = createTableId('a');
    const foreignPrimaryId = createFieldId('b');
    const foreignLookupFieldId = createFieldId('c');
    const filterFieldId = createFieldId('d');
    const expectedOptions = createSelectOptions([
      { id: 'cho_dup_core', name: 'Core', color: 'blueBright' },
      { id: 'cho_dup_important', name: 'Important', color: 'greenBright' },
    ]);
    const brokenOptions = createSelectOptions([
      { id: 'cho_dup_broken_1', name: 'Option 1', color: 'blueBright' },
      { id: 'cho_dup_broken_2', name: 'Option 2', color: 'greenBright' },
    ]);

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleSelect()
      .withId(foreignLookupFieldId)
      .withName(FieldName.create('Importance')._unsafeUnwrap())
      .withOptions(expectedOptions)
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const field = ConditionalLookupField.create({
      id: createFieldId('e'),
      name: FieldName.create('Importance Lookup')._unsafeUnwrap(),
      innerField: SingleSelectField.create({
        id: foreignLookupFieldId,
        name: FieldName.create('Importance')._unsafeUnwrap(),
        options: brokenOptions,
      })._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignLookupFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: filterFieldId.toString(), operator: 'is', value: 'Active' }],
          },
        },
      })._unsafeUnwrap(),
      innerOptionsPatch: {
        choices: brokenOptions.map((option) => option.toDto()),
      },
    })._unsafeUnwrap();

    const duplicated = field
      .duplicate({
        newId: createFieldId('f'),
        newName: FieldName.create('Importance Lookup Copy')._unsafeUnwrap(),
        baseId,
        tableId: hostTableId,
        foreignTables: [foreignTable],
      })
      ._unsafeUnwrap() as ConditionalLookupField;

    expect(duplicated.innerOptionsPatch()).toBeUndefined();
    const innerField = duplicated.innerField()._unsafeUnwrap() as SingleSelectField;
    expect(innerField.selectOptions().map((option) => option.toDto())).toEqual(
      expectedOptions.map((option) => option.toDto())
    );
  });
});

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

  it('emits field type update when lookup target is type-converted', () => {
    const lookupTargetFieldId = createFieldId('g');
    const conditionalLookup = ConditionalLookupField.create({
      id: createFieldId('h'),
      name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
      innerField: SingleLineTextField.create({
        id: lookupTargetFieldId,
        name: FieldName.create('Task')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: createTableId('i').toString(),
        lookupFieldId: lookupTargetFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: createFieldId('j').toString(), operator: 'is', value: 'A' }],
          },
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const convertedField = LongTextField.create({
      id: lookupTargetFieldId,
      name: FieldName.create('Task')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const typeSpec = TableUpdateFieldTypeSpec.create(
      conditionalLookup.innerField()._unsafeUnwrap(),
      convertedField
    );

    const result = conditionalLookup.onDependencyUpdated(convertedField, [typeSpec], {
      table: {} as never,
      foreignTables: [],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldTypeSpec);

    const spec = result._unsafeUnwrap() as TableUpdateFieldTypeSpec;
    const nextField = spec.newField() as ConditionalLookupField;
    expect(nextField.hasError().toBoolean()).toBe(false);
    expect(nextField.innerField()._unsafeUnwrap()).toBeInstanceOf(LongTextField);
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

  it('emits field type update when lookup target select options are changed', () => {
    const foreignTableId = createTableId('n');
    const lookupFieldId = createFieldId('o');
    const filterFieldId = createFieldId('p');

    const previousInnerField = SingleSelectField.create({
      id: lookupFieldId,
      name: FieldName.create('Status')._unsafeUnwrap(),
      options: [SelectOption.create({ id: 'cho_x', name: 'x', color: 'cyan' })._unsafeUnwrap()],
    })._unsafeUnwrap();

    const conditionalLookup = ConditionalLookupField.create({
      id: createFieldId('q'),
      name: FieldName.create('Conditional Lookup Status')._unsafeUnwrap(),
      innerField: previousInnerField,
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: filterFieldId.toString(), operator: 'isNotEmpty' }],
          },
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const updatedInnerField = SingleSelectField.create({
      id: lookupFieldId,
      name: FieldName.create('Status')._unsafeUnwrap(),
      options: [
        SelectOption.create({ id: 'cho_x', name: 'x', color: 'cyan' })._unsafeUnwrap(),
        SelectOption.create({ id: 'cho_y', name: 'y', color: 'blue' })._unsafeUnwrap(),
      ],
    })._unsafeUnwrap();

    const foreignTableBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(createBaseId('r'))
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignTableBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('s'))
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    foreignTableBuilder
      .field()
      .singleSelect()
      .withId(lookupFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions(updatedInnerField.selectOptions())
      .done();
    foreignTableBuilder.view().defaultGrid().done();
    const foreignTable = foreignTableBuilder.build()._unsafeUnwrap();

    const optionsSpec = UpdateSingleSelectOptionsSpec.create(
      lookupFieldId,
      DbFieldName.rehydrate('status')._unsafeUnwrap(),
      previousInnerField.selectOptions(),
      updatedInnerField.selectOptions()
    );

    const result = conditionalLookup.onDependencyUpdated(updatedInnerField, [optionsSpec], {
      table: {} as Table,
      foreignTables: [foreignTable],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldTypeSpec);

    const spec = result._unsafeUnwrap() as TableUpdateFieldTypeSpec;
    const nextField = spec.newField() as ConditionalLookupField;
    const nextInnerField = nextField.innerField()._unsafeUnwrap() as SingleSelectField;
    expect(nextInnerField.selectOptions()).toHaveLength(2);
    expect(nextInnerField.selectOptions()[1]?.name().toString()).toBe('y');
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

  it('drops sort but keeps limit when the foreign sort field is deleted', () => {
    const foreignTableId = createTableId('i');
    const lookupFieldId = createFieldId('j');
    const sortFieldId = createFieldId('k');
    const hostPrimaryFieldId = createFieldId('l');
    const conditionalLookup = ConditionalLookupField.create({
      id: createFieldId('m'),
      name: FieldName.create('Conditional Lookup Sorted')._unsafeUnwrap(),
      innerField: SingleLineTextField.create({
        id: createFieldId('n'),
        name: FieldName.create('Title')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: lookupFieldId.toString(), operator: 'isNotEmpty' }],
          },
          sort: { fieldId: sortFieldId.toString(), order: 'desc' },
          limit: 2,
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const hostTableBuilder = Table.builder()
      .withId(createTableId('o'))
      .withBaseId(createBaseId('p'))
      .withName(TableName.create('Host')._unsafeUnwrap());
    hostTableBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryFieldId)
      .withName(FieldName.create('Host Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostTableBuilder.view().defaultGrid().done();
    const hostTable = hostTableBuilder.build()._unsafeUnwrap();

    const foreignTableBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(createBaseId('p'))
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignTableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldId)
      .withName(FieldName.create('Lookup')._unsafeUnwrap())
      .primary()
      .done();
    foreignTableBuilder
      .field()
      .number()
      .withId(sortFieldId)
      .withName(FieldName.create('Score')._unsafeUnwrap())
      .done();
    foreignTableBuilder.view().defaultGrid().done();
    const foreignTable = foreignTableBuilder.build()._unsafeUnwrap();

    const deletedField = foreignTable.getFields().find((field) => field.id().equals(sortFieldId));
    expect(deletedField).toBeDefined();
    if (!deletedField) return;

    const result = conditionalLookup.onFieldDeleted(deletedField, {
      table: hostTable,
      sourceTable: foreignTable,
      previousSourceTable: foreignTable,
    });
    expect(result.isOk()).toBe(true);
    const reaction = result._unsafeUnwrap();
    expect(reaction?.spec).toBeInstanceOf(TableUpdateFieldTypeSpec);
    expect(reaction?.relatedFieldIds.map((id) => id.toString())).toEqual([
      conditionalLookup.id().toString(),
    ]);

    const spec = reaction?.spec as TableUpdateFieldTypeSpec;
    const nextField = spec.newField() as ConditionalLookupField;
    const nextCondition = nextField.conditionalLookupOptions().condition().toDto();

    expect(nextCondition.sort).toBeUndefined();
    expect(nextCondition.limit).toBe(2);
    expect(nextCondition.filter).toEqual({
      conjunction: 'and',
      filterSet: [{ fieldId: lookupFieldId.toString(), operator: 'isNotEmpty' }],
    });
  });

  it('preserves existing error when the foreign sort field is deleted', () => {
    const foreignTableId = createTableId('q');
    const lookupFieldId = createFieldId('r');
    const sortFieldId = createFieldId('s');
    const hostPrimaryFieldId = createFieldId('t');
    const conditionalLookupFieldId = createFieldId('u');
    const conditionalLookup = ConditionalLookupField.create({
      id: conditionalLookupFieldId,
      name: FieldName.create('Conditional Lookup Sorted')._unsafeUnwrap(),
      innerField: SingleLineTextField.create({
        id: createFieldId('v'),
        name: FieldName.create('Title')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: lookupFieldId.toString(), operator: 'isNotEmpty' }],
          },
          sort: { fieldId: sortFieldId.toString(), order: 'desc' },
          limit: 2,
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const hostTableBuilder = Table.builder()
      .withId(createTableId('w'))
      .withBaseId(createBaseId('x'))
      .withName(TableName.create('Host')._unsafeUnwrap());
    hostTableBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryFieldId)
      .withName(FieldName.create('Host Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostTableBuilder.view().defaultGrid().done();
    const hostTable = hostTableBuilder.build()._unsafeUnwrap();

    const foreignTableBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(createBaseId('x'))
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignTableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldId)
      .withName(FieldName.create('Lookup')._unsafeUnwrap())
      .primary()
      .done();
    foreignTableBuilder
      .field()
      .number()
      .withId(sortFieldId)
      .withName(FieldName.create('Score')._unsafeUnwrap())
      .done();
    foreignTableBuilder.view().defaultGrid().done();
    const foreignTable = foreignTableBuilder.build()._unsafeUnwrap();

    const hostWithConditionalLookup = hostTable
      .addField(conditionalLookup, { foreignTables: [foreignTable] })
      ._unsafeUnwrap();
    const fieldInHost = hostWithConditionalLookup
      .getField((field) => field.id().equals(conditionalLookupFieldId))
      ._unsafeUnwrap() as ConditionalLookupField;
    fieldInHost.setHasError(FieldHasError.error());

    const deletedField = foreignTable.getFields().find((field) => field.id().equals(sortFieldId));
    expect(deletedField).toBeDefined();
    if (!deletedField) return;

    const result = fieldInHost.onFieldDeleted(deletedField, {
      table: hostWithConditionalLookup,
      sourceTable: foreignTable,
      previousSourceTable: foreignTable,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.relatedFieldIds.map((id) => id.toString())).toEqual([
      conditionalLookupFieldId.toString(),
    ]);

    const updatedTable = result._unsafeUnwrap()?.spec.mutate(hostWithConditionalLookup);
    expect(updatedTable?.isOk()).toBe(true);
    const updatedField = updatedTable
      ?._unsafeUnwrap()
      .getField((field) => field.id().equals(conditionalLookupFieldId));
    expect(updatedField?.isOk()).toBe(true);

    const nextField = updatedField?._unsafeUnwrap() as ConditionalLookupField;
    expect(nextField.hasError().isError()).toBe(true);
    expect(nextField.conditionalLookupOptions().condition().toDto().sort).toBeUndefined();
  });

  it('sets hasError when the foreign table is deleted', () => {
    const foreignTableId = createTableId('y');
    const lookupFieldId = createFieldId('z');
    const sortFieldId = createFieldId('a');

    const conditionalLookup = ConditionalLookupField.create({
      id: createFieldId('b'),
      name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
      innerField: SingleLineTextField.create({
        id: createFieldId('c'),
        name: FieldName.create('Lookup Inner')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: lookupFieldId.toString(), operator: 'isNotEmpty' }],
          },
          sort: { fieldId: sortFieldId.toString(), order: 'desc' },
          limit: 2,
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const result = conditionalLookup.onTableDeleted({ id: () => foreignTableId } as never, {
      table: {} as never,
      hooks: {
        createFieldUpdateAfterPersistHook: () => async () =>
          ok({
            events: [],
            table: {} as never,
          }),
      },
    });

    expect(result.isOk()).toBe(true);
    const reaction = result._unsafeUnwrap();
    expect(reaction?.spec).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
    expect(reaction?.afterPersist).toBeUndefined();
  });
});
