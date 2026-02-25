import { describe, expect, it } from 'vitest';

import { DbFieldName } from '../DbFieldName';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import { UpdateSingleSelectOptionsSpec } from '../../specs/field-updates/UpdateSingleSelectOptionsSpec';
import { TableId } from '../../TableId';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { ConditionalRollupConfig } from './ConditionalRollupConfig';
import { ConditionalRollupField } from './ConditionalRollupField';
import { RollupExpression } from './RollupExpression';
import { SelectOption } from './SelectOption';
import { SingleLineTextField } from './SingleLineTextField';
import { SingleSelectField } from './SingleSelectField';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();

const createConditionalRollupField = (statusFieldId: FieldId) => {
  const config = ConditionalRollupConfig.create({
    foreignTableId: createTableId('a').toString(),
    lookupFieldId: createFieldId('b').toString(),
    condition: {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
      },
    },
  })._unsafeUnwrap();

  return ConditionalRollupField.createPending({
    id: createFieldId('c'),
    name: FieldName.create('Conditional Rollup')._unsafeUnwrap(),
    config,
    expression: RollupExpression.default(),
    resultType: {
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    },
  })._unsafeUnwrap();
};

describe('ConditionalRollupConfig.create', () => {
  it('accepts config with a valid filter', () => {
    const result = ConditionalRollupConfig.create({
      foreignTableId: createTableId('a').toString(),
      lookupFieldId: createFieldId('b').toString(),
      condition: {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: createFieldId('f').toString(), operator: 'is', value: 'Active' }],
        },
      },
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().condition().hasFilter()).toBe(true);
  });

  it('accepts config without a filter (V1 compatibility)', () => {
    const result = ConditionalRollupConfig.create({
      foreignTableId: createTableId('a').toString(),
      lookupFieldId: createFieldId('b').toString(),
      condition: {
        filter: null,
      },
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().condition().hasFilter()).toBe(false);
  });

  it('accepts config with undefined filter (V1 DB deserialization)', () => {
    const result = ConditionalRollupConfig.create({
      foreignTableId: createTableId('a').toString(),
      lookupFieldId: createFieldId('b').toString(),
      condition: {
        filter: undefined,
      },
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().condition().hasFilter()).toBe(false);
  });

  it('accepts config with empty condition object', () => {
    const result = ConditionalRollupConfig.create({
      foreignTableId: createTableId('a').toString(),
      lookupFieldId: createFieldId('b').toString(),
      condition: {},
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().condition().hasFilter()).toBe(false);
  });

  it('rejects config with missing foreignTableId', () => {
    const result = ConditionalRollupConfig.create({
      foreignTableId: '',
      lookupFieldId: createFieldId('b').toString(),
      condition: { filter: null },
    });
    expect(result.isErr()).toBe(true);
  });

  it('rejects config with missing lookupFieldId', () => {
    const result = ConditionalRollupConfig.create({
      foreignTableId: createTableId('a').toString(),
      lookupFieldId: '',
      condition: { filter: null },
    });
    expect(result.isErr()).toBe(true);
  });
});

describe('ConditionalRollupField without filter', () => {
  it('creates a pending field with no-filter config', () => {
    const config = ConditionalRollupConfig.create({
      foreignTableId: createTableId('a').toString(),
      lookupFieldId: createFieldId('b').toString(),
      condition: { filter: null },
    })._unsafeUnwrap();

    const result = ConditionalRollupField.createPending({
      id: createFieldId('g'),
      name: FieldName.create('No Filter Rollup')._unsafeUnwrap(),
      config,
      expression: RollupExpression.default(),
    });
    expect(result.isOk()).toBe(true);
    const field = result._unsafeUnwrap();
    expect(field.type().toString()).toBe('conditionalRollup');
    expect(field.config().condition().hasFilter()).toBe(false);
    expect(field.lookupFieldId().toString()).toBe(createFieldId('b').toString());
  });
});

describe('ConditionalRollupField.onDependencyUpdated', () => {
  it('marks hasError when referenced field is type-converted', () => {
    const statusFieldId = createFieldId('d');
    const conditionalRollup = createConditionalRollupField(statusFieldId);
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

    const result = conditionalRollup.onDependencyUpdated(updatedField, [typeSpec], {} as never);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
  });

  it('emits field type update when referenced select option name changes', () => {
    const statusFieldId = createFieldId('e');
    const conditionalRollup = createConditionalRollupField(statusFieldId);
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

    const result = conditionalRollup.onDependencyUpdated(statusField, [optionsSpec], {} as never);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]).toBeInstanceOf(TableUpdateFieldTypeSpec);

    const spec = result._unsafeUnwrap()[0] as TableUpdateFieldTypeSpec;
    const nextField = spec.newField() as ConditionalRollupField;
    const nextFilter = nextField.config().condition().toDto().filter as {
      filterSet: Array<{ value?: unknown }>;
    };
    expect(nextFilter.filterSet[0]?.value).toBe('Active Plus');
  });
});
