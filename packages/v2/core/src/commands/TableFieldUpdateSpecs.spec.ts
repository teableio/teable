import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { FieldValueTypeVisitor } from '../domain/table/fields/visitors/FieldValueTypeVisitor';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { buildUpdateFieldSpecs, parseUpdateFieldSpec } from './TableFieldUpdateSpecs';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

describe('TableFieldUpdateSpecs', () => {
  it('stabilizes missing dbFieldName with field id during type conversion', () => {
    const baseId = createBaseId('d');
    const tableId = createTableId('d');
    const targetFieldId = createFieldId('e');

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Db Name Hydration')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(createFieldId('f'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .singleLineText()
      .withId(targetFieldId)
      .withName(FieldName.create('To Convert')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const currentField = table
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();
    expect(currentField.dbFieldName().isErr()).toBe(true);

    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'singleSelect',
        dbFieldName: 'legacy_column_name',
        options: { choices: [] },
      },
      { hostTable: table }
    );

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }

    const typeSpec = specsResult.value.find(
      (spec): spec is TableUpdateFieldTypeSpec => spec instanceof TableUpdateFieldTypeSpec
    );
    expect(typeSpec).toBeDefined();
    if (!typeSpec) {
      return;
    }

    const oldDbFieldName = typeSpec
      .oldField()
      .dbFieldName()
      .andThen((name) => name.value());
    const newDbFieldName = typeSpec
      .newField()
      .dbFieldName()
      .andThen((name) => name.value());
    expect(oldDbFieldName.isOk()).toBe(true);
    expect(newDbFieldName.isOk()).toBe(true);
    expect(oldDbFieldName._unsafeUnwrap()).toBe(targetFieldId.toString());
    expect(newDbFieldName._unsafeUnwrap()).toBe(targetFieldId.toString());
  });

  it('keeps existing dbFieldName stable when payload carries legacy dbFieldName', () => {
    const baseId = createBaseId('p');
    const tableId = createTableId('p');
    const targetFieldId = createFieldId('q');

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Db Name Stability')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(createFieldId('r'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .singleLineText()
      .withId(targetFieldId)
      .withName(FieldName.create('To Convert')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const currentField = table
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();
    currentField
      .setDbFieldName(DbFieldName.rehydrate('stable_current_column')._unsafeUnwrap())
      ._unsafeUnwrap();

    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'singleSelect',
        dbFieldName: 'legacy_column_name',
        options: { choices: [] },
      },
      { hostTable: table }
    );

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }

    const typeSpec = specsResult.value.find(
      (spec): spec is TableUpdateFieldTypeSpec => spec instanceof TableUpdateFieldTypeSpec
    );
    expect(typeSpec).toBeDefined();
    if (!typeSpec) {
      return;
    }

    const oldDbFieldName = typeSpec
      .oldField()
      .dbFieldName()
      .andThen((name) => name.value());
    const newDbFieldName = typeSpec
      .newField()
      .dbFieldName()
      .andThen((name) => name.value());
    expect(oldDbFieldName.isOk()).toBe(true);
    expect(newDbFieldName.isOk()).toBe(true);
    expect(oldDbFieldName._unsafeUnwrap()).toBe('stable_current_column');
    expect(newDbFieldName._unsafeUnwrap()).toBe('stable_current_column');
  });

  it('derives rollup resultType for type conversion when cellValueType is omitted', () => {
    const baseId = createBaseId('a');
    const hostTableId = createTableId('h');
    const foreignTableId = createTableId('f');

    const targetFieldId = createFieldId('d');
    const linkFieldId = createFieldId('l');
    const foreignPrimaryFieldId = createFieldId('p');
    const foreignNumberFieldId = createFieldId('n');

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('x'))
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .date()
      .withId(targetFieldId)
      .withName(FieldName.create('Date Field')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryFieldId)
      .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .number()
      .withId(foreignNumberFieldId)
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();

    const specResult = parseUpdateFieldSpec(
      currentField,
      {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        config: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignNumberFieldId.toString(),
        },
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
    );

    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) {
      return;
    }

    const newFieldResult = specResult.value.createField();
    expect(newFieldResult.isOk()).toBe(true);
    if (newFieldResult.isErr()) {
      return;
    }

    const newField = newFieldResult.value;
    expect(newField.type().toString()).toBe('rollup');
    const valueTypeResult = newField.accept(new FieldValueTypeVisitor());
    expect(valueTypeResult.isOk()).toBe(true);
    if (valueTypeResult.isErr()) {
      return;
    }
    expect(valueTypeResult.value.cellValueType.toString()).toBe('number');
    expect(valueTypeResult.value.isMultipleCellValue.toBoolean()).toBe(false);
  });

  it('derives single-value lookup multiplicity from manyOne link during type conversion', () => {
    const baseId = createBaseId('m');
    const hostTableId = createTableId('m');
    const foreignTableId = createTableId('n');
    const targetFieldId = createFieldId('q');
    const linkFieldId = createFieldId('r');
    const foreignLookupFieldId = createFieldId('s');

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignLookupFieldId.toString(),
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Lookup Host ManyOne')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('u'))
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .singleLineText()
      .withId(targetFieldId)
      .withName(FieldName.create('Lookup Target')._unsafeUnwrap())
      .done();
    hostBuilder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Ref Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();

    const specResult = parseUpdateFieldSpec(
      currentField,
      {
        type: 'lookup',
        options: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignLookupFieldId.toString(),
        },
      },
      { hostTable }
    );

    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) {
      return;
    }

    const newFieldResult = specResult.value.createField();
    expect(newFieldResult.isOk()).toBe(true);
    if (newFieldResult.isErr()) {
      return;
    }

    const valueTypeResult = newFieldResult.value.accept(new FieldValueTypeVisitor());
    expect(valueTypeResult.isOk()).toBe(true);
    if (valueTypeResult.isErr()) {
      return;
    }

    expect(valueTypeResult.value.isMultipleCellValue.toBoolean()).toBe(false);
  });

  it('derives multi-value lookup multiplicity from oneMany link during type conversion', () => {
    const baseId = createBaseId('w');
    const hostTableId = createTableId('w');
    const foreignTableId = createTableId('x');
    const targetFieldId = createFieldId('y');
    const linkFieldId = createFieldId('z');
    const foreignLookupFieldId = createFieldId('k');

    const linkConfig = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignLookupFieldId.toString(),
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Lookup Host OneMany')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('o'))
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .singleLineText()
      .withId(targetFieldId)
      .withName(FieldName.create('Lookup Target')._unsafeUnwrap())
      .done();
    hostBuilder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Ref Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();

    const specResult = parseUpdateFieldSpec(
      currentField,
      {
        type: 'lookup',
        options: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignLookupFieldId.toString(),
        },
      },
      { hostTable }
    );

    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) {
      return;
    }

    const newFieldResult = specResult.value.createField();
    expect(newFieldResult.isOk()).toBe(true);
    if (newFieldResult.isErr()) {
      return;
    }

    const valueTypeResult = newFieldResult.value.accept(new FieldValueTypeVisitor());
    expect(valueTypeResult.isOk()).toBe(true);
    if (valueTypeResult.isErr()) {
      return;
    }

    expect(valueTypeResult.value.isMultipleCellValue.toBoolean()).toBe(true);
  });
});
