import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { LongTextField } from './LongTextField';
import { NumberField } from './NumberField';
import { RollupExpression } from './RollupExpression';
import { RollupField } from './RollupField';
import { RollupFieldConfig } from './RollupFieldConfig';
import { SingleLineTextField } from './SingleLineTextField';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();

describe('RollupField.onDependencyUpdated', () => {
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
