import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { FieldHasError } from './FieldHasError';
import { LinkField } from './LinkField';
import { LinkFieldConfig } from './LinkFieldConfig';
import { LongTextField } from './LongTextField';
import { NumberField } from './NumberField';
import { NumberShowAs } from './NumberShowAs';
import { RollupExpression } from './RollupExpression';
import { RollupField } from './RollupField';
import { RollupFieldConfig } from './RollupFieldConfig';
import { SingleLineTextField } from './SingleLineTextField';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();

describe('RollupField.onDependencyUpdated', () => {
  it('applies result type and default formatting for pending numeric rollup', () => {
    const rollupField = RollupField.createPending({
      id: createFieldId('a'),
      name: FieldName.create('Pending Sum')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: createFieldId('b').toString(),
        foreignTableId: createTableId('a').toString(),
        lookupFieldId: createFieldId('c').toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();

    expect(rollupField.cellValueType()._unsafeUnwrap().toString()).toBe('number');
    expect(rollupField.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(false);
    expect(rollupField.formatting()).toBeDefined();
  });

  it('rejects invalid numeric showAs for multiple rollup result type', () => {
    const result = RollupField.createPending({
      id: createFieldId('d'),
      name: FieldName.create('Pending Chart')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: createFieldId('e').toString(),
        foreignTableId: createTableId('b').toString(),
        lookupFieldId: createFieldId('f').toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      showAs: NumberShowAs.create({
        type: 'ring',
        color: 'blue',
        showValue: true,
        maxValue: 100,
      })._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.multiple(),
      },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid RollupField showAs');
  });

  it('emits field type update when lookup target is type-converted compatibly', () => {
    const linkFieldId = createFieldId('a');
    const lookupFieldId = createFieldId('b');
    const valuesField = SingleLineTextField.create({
      id: lookupFieldId,
      name: FieldName.create('Task')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const rollupField = RollupField.create({
      id: createFieldId('c'),
      name: FieldName.create('Task Count')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: createTableId('d').toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('countall({values})')._unsafeUnwrap(),
      valuesField,
    })._unsafeUnwrap();

    const convertedField = LongTextField.create({
      id: lookupFieldId,
      name: FieldName.create('Task')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const typeSpec = TableUpdateFieldTypeSpec.create(valuesField, convertedField);

    const result = rollupField.onDependencyUpdated(convertedField, [typeSpec], {
      table: {} as never,
      foreignTables: [],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldTypeSpec);

    const spec = result._unsafeUnwrap() as TableUpdateFieldTypeSpec;
    const nextField = spec.newField() as RollupField;
    expect(nextField.hasError().isError()).toBe(false);
    expect(nextField.cellValueType()._unsafeUnwrap().toString()).toBe('number');
  });

  it('marks hasError when lookup target type-conversion makes aggregation invalid', () => {
    const linkFieldId = createFieldId('e');
    const lookupFieldId = createFieldId('f');
    const valuesField = NumberField.create({
      id: lookupFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const rollupField = RollupField.create({
      id: createFieldId('g'),
      name: FieldName.create('Amount Sum')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: createTableId('h').toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      valuesField,
    })._unsafeUnwrap();

    const convertedField = LongTextField.create({
      id: lookupFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const typeSpec = TableUpdateFieldTypeSpec.create(valuesField, convertedField);

    const result = rollupField.onDependencyUpdated(convertedField, [typeSpec], {
      table: {} as never,
      foreignTables: [],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
  });

  it('clears hasError when link field is converted back to the expected foreign table', () => {
    const linkFieldId = createFieldId('m');
    const lookupFieldId = createFieldId('n');
    const foreignTableId = createTableId('n');
    const valuesField = NumberField.create({
      id: lookupFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const rollupField = RollupField.create({
      id: createFieldId('o'),
      name: FieldName.create('Recovered Sum')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      valuesField,
    })._unsafeUnwrap();
    rollupField.setHasError(FieldHasError.error());

    const oldLinkField = LinkField.create({
      id: linkFieldId,
      name: FieldName.create('Old Link')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: createTableId('o').toString(),
        lookupFieldId: createFieldId('p').toString(),
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const newLinkField = LinkField.create({
      id: linkFieldId,
      name: FieldName.create('New Link')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: createFieldId('q').toString(),
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const result = rollupField.onDependencyUpdated(
      newLinkField,
      [TableUpdateFieldTypeSpec.create(oldLinkField, newLinkField)],
      {
        table: {} as never,
        foreignTables: [],
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
    expect((result._unsafeUnwrap() as TableUpdateFieldHasErrorSpec).nextHasError().isError()).toBe(
      false
    );
  });

  it('sets hasError when link field is deleted from host table', () => {
    const linkFieldId = createFieldId('r');
    const lookupFieldId = createFieldId('s');
    const valuesField = NumberField.create({
      id: lookupFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const rollupField = RollupField.create({
      id: createFieldId('t'),
      name: FieldName.create('Amount Sum')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: createTableId('t').toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      valuesField,
    })._unsafeUnwrap();

    const deletedLinkField = LinkField.create({
      id: linkFieldId,
      name: FieldName.create('Tasks')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: createTableId('t').toString(),
        lookupFieldId: createFieldId('u').toString(),
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const result = rollupField.onFieldDeleted(deletedLinkField, {
      table: { id: () => createTableId('u') } as never,
      sourceTable: { id: () => createTableId('u') } as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.spec).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
  });

  it('sets hasError when lookup field is deleted from foreign table', () => {
    const linkFieldId = createFieldId('v');
    const lookupFieldId = createFieldId('w');
    const foreignTableId = createTableId('v');
    const valuesField = NumberField.create({
      id: lookupFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const rollupField = RollupField.create({
      id: createFieldId('x'),
      name: FieldName.create('Amount Sum')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      valuesField,
    })._unsafeUnwrap();

    const deletedLookupField = NumberField.create({
      id: lookupFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const result = rollupField.onFieldDeleted(deletedLookupField, {
      table: { id: () => createTableId('x') } as never,
      sourceTable: { id: () => foreignTableId } as never,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()?.spec).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
  });

  it('sets hasError when the foreign table is deleted', () => {
    const linkFieldId = createFieldId('i');
    const lookupFieldId = createFieldId('j');
    const foreignTableId = createTableId('k');
    const valuesField = NumberField.create({
      id: lookupFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const rollupField = RollupField.create({
      id: createFieldId('l'),
      name: FieldName.create('Amount Sum')._unsafeUnwrap(),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      valuesField,
    })._unsafeUnwrap();

    const result = rollupField.onTableDeleted({ id: () => foreignTableId } as never, {
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
