import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { CellValueMultiplicity } from '../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../domain/table/fields/types/CellValueType';
import { ConditionalLookupOptions } from '../domain/table/fields/types/ConditionalLookupOptions';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../domain/table/fields/types/FormulaField';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { LookupOptions } from '../domain/table/fields/types/LookupOptions';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import { FieldValueTypeVisitor } from '../domain/table/fields/visitors/FieldValueTypeVisitor';
import { UpdateLinkConfigSpec } from '../domain/table/specs/field-updates/UpdateLinkConfigSpec';
import { UpdateLookupOptionsSpec } from '../domain/table/specs/field-updates/UpdateLookupOptionsSpec';
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

  it('clears lookup filter/sort/limit when replaceOptions is enabled', () => {
    const baseId = createBaseId('g');
    const hostTableId = createTableId('g');
    const foreignTableId = createTableId('h');
    const foreignPrimaryId = createFieldId('i');
    const foreignStatusId = createFieldId('j');
    const foreignScoreId = createFieldId('k');
    const hostPrimaryId = createFieldId('l');
    const linkFieldId = createFieldId('m');
    const lookupFieldId = createFieldId('n');

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Lookup Replace Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignStatusId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .done();
    foreignBuilder
      .field()
      .number()
      .withId(foreignScoreId)
      .withName(FieldName.create('Score')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
    })._unsafeUnwrap();

    const lookupOptions = LookupOptions.create({
      linkFieldId: linkFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: foreignStatusId.toString(), operator: 'is', value: 'Active' }],
      },
      sort: { fieldId: foreignScoreId.toString(), order: 'desc' },
      limit: 1,
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Lookup Replace Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    hostBuilder
      .field()
      .lookup()
      .withId(lookupFieldId)
      .withName(FieldName.create('Lookup')._unsafeUnwrap())
      .withInnerField(
        SingleLineTextField.create({
          id: createFieldId('o'),
          name: FieldName.create('Inner')._unsafeUnwrap(),
        })._unsafeUnwrap()
      )
      .withLookupOptions(lookupOptions)
      .withIsMultipleCellValue(false)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(lookupFieldId))
      ._unsafeUnwrap();
    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'lookup',
        options: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryId.toString(),
        },
        replaceOptions: true,
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
    );

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }

    const lookupSpec = specsResult.value.find(
      (spec): spec is UpdateLookupOptionsSpec => spec instanceof UpdateLookupOptionsSpec
    );
    expect(lookupSpec).toBeDefined();
    if (!lookupSpec) {
      return;
    }

    const nextOptions = lookupSpec.nextOptions().toDto();
    expect(nextOptions.filter).toBeUndefined();
    expect(nextOptions.sort).toBeUndefined();
    expect(nextOptions.limit).toBeUndefined();
  });

  it('keeps lookup filter/sort/limit when replaceOptions is disabled', () => {
    const baseId = createBaseId('p');
    const hostTableId = createTableId('p');
    const foreignTableId = createTableId('q');
    const foreignPrimaryId = createFieldId('r');
    const foreignStatusId = createFieldId('s');
    const foreignScoreId = createFieldId('t');
    const hostPrimaryId = createFieldId('u');
    const linkFieldId = createFieldId('v');
    const lookupFieldId = createFieldId('w');

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Lookup Keep Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignStatusId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .done();
    foreignBuilder
      .field()
      .number()
      .withId(foreignScoreId)
      .withName(FieldName.create('Score')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
    })._unsafeUnwrap();

    const lookupOptions = LookupOptions.create({
      linkFieldId: linkFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: foreignStatusId.toString(), operator: 'is', value: 'Active' }],
      },
      sort: { fieldId: foreignScoreId.toString(), order: 'desc' },
      limit: 1,
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Lookup Keep Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    hostBuilder
      .field()
      .lookup()
      .withId(lookupFieldId)
      .withName(FieldName.create('Lookup')._unsafeUnwrap())
      .withInnerField(
        SingleLineTextField.create({
          id: createFieldId('x'),
          name: FieldName.create('Inner')._unsafeUnwrap(),
        })._unsafeUnwrap()
      )
      .withLookupOptions(lookupOptions)
      .withIsMultipleCellValue(false)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(lookupFieldId))
      ._unsafeUnwrap();
    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'lookup',
        options: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryId.toString(),
        },
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
    );

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }
    expect(specsResult.value).toHaveLength(0);
  });

  it('preserves inner formula result type when conditional lookup updates condition only', () => {
    const baseId = createBaseId('h');
    const hostTableId = createTableId('h');
    const foreignTableId = createTableId('i');
    const hostPrimaryId = createFieldId('j');
    const hostStatusId = createFieldId('k');
    const conditionalLookupFieldId = createFieldId('l');
    const foreignLookupFieldId = createFieldId('m');

    const innerFormulaField = FormulaField.create({
      id: conditionalLookupFieldId,
      name: FieldName.create('Inner Formula')._unsafeUnwrap(),
      expression: FormulaExpression.create('NOW()')._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();

    const conditionalLookupOptions = ConditionalLookupOptions.create({
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignLookupFieldId.toString(),
      condition: {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: hostStatusId.toString(), operator: 'is', value: 'active' }],
        },
        sort: { fieldId: hostPrimaryId.toString(), order: 'asc' },
        limit: 200,
      },
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Conditional Lookup Host')._unsafeUnwrap());
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
    hostBuilder
      .field()
      .conditionalLookup()
      .withId(conditionalLookupFieldId)
      .withName(FieldName.create('Conditional Lookup')._unsafeUnwrap())
      .withInnerField(innerFormulaField)
      .withConditionalLookupOptions(conditionalLookupOptions)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(conditionalLookupFieldId))
      ._unsafeUnwrap();
    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'conditionalLookup',
        options: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignLookupFieldId.toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: hostStatusId.toString(), operator: 'is', value: 'active' }],
            },
          },
          innerType: 'formula',
          innerOptions: {
            expression: 'NOW()',
            timeZone: 'Asia/Shanghai',
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
          },
        },
      },
      {
        hostTable,
      }
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

    const nextValueTypeResult = typeSpec.newField().accept(new FieldValueTypeVisitor());
    expect(nextValueTypeResult.isOk()).toBe(true);
    if (nextValueTypeResult.isErr()) {
      return;
    }
    expect(nextValueTypeResult.value.cellValueType.toString()).toBe('dateTime');
    expect(nextValueTypeResult.value.isMultipleCellValue.toBoolean()).toBe(true);
  });

  it('derives inner formula result type for pending conditional lookup updates', () => {
    const baseId = createBaseId('n');
    const hostTableId = createTableId('n');
    const foreignTableId = createTableId('o');
    const hostPrimaryId = createFieldId('p');
    const hostStatusId = createFieldId('q');
    const conditionalLookupFieldId = createFieldId('r');
    const foreignPrimaryId = createFieldId('s');

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Conditional Lookup Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const conditionalLookupOptions = ConditionalLookupOptions.create({
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      condition: {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: hostStatusId.toString(), operator: 'is', value: 'active' }],
        },
        sort: { fieldId: hostPrimaryId.toString(), order: 'asc' },
        limit: 1,
      },
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Conditional Lookup Pending Host')._unsafeUnwrap());
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
    hostBuilder
      .field()
      .conditionalLookup()
      .withId(conditionalLookupFieldId)
      .withName(FieldName.create('Pending Conditional Lookup')._unsafeUnwrap())
      .withConditionalLookupOptions(conditionalLookupOptions)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(conditionalLookupFieldId))
      ._unsafeUnwrap();
    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'conditionalLookup',
        options: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryId.toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: hostStatusId.toString(), operator: 'is', value: 'active' }],
            },
          },
          innerType: 'formula',
          innerOptions: {
            expression: 'NOW()',
            timeZone: 'Asia/Shanghai',
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
          },
        },
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
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

    const nextValueTypeResult = typeSpec.newField().accept(new FieldValueTypeVisitor());
    expect(nextValueTypeResult.isOk()).toBe(true);
    if (nextValueTypeResult.isErr()) {
      return;
    }
    expect(nextValueTypeResult.value.cellValueType.toString()).toBe('dateTime');
    expect(nextValueTypeResult.value.isMultipleCellValue.toBoolean()).toBe(true);
  });

  it('clears link filter options when replaceOptions is enabled', () => {
    const baseId = createBaseId('y');
    const hostTableId = createTableId('y');
    const foreignTableId = createTableId('z');
    const foreignPrimaryId = createFieldId('a');
    const foreignStatusId = createFieldId('b');
    const hostPrimaryId = createFieldId('c');
    const linkFieldId = createFieldId('d');

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Link Replace Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignStatusId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      filterByViewId: `viw${'v'.repeat(16)}`,
      visibleFieldIds: [foreignPrimaryId.toString()],
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: foreignStatusId.toString(), operator: 'is', value: 'Active' }],
      },
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Link Replace Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(linkFieldId))
      ._unsafeUnwrap();
    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryId.toString(),
        },
        replaceOptions: true,
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
    );

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }

    const linkSpec = specsResult.value.find(
      (spec): spec is UpdateLinkConfigSpec => spec instanceof UpdateLinkConfigSpec
    );
    expect(linkSpec).toBeDefined();
    if (!linkSpec) {
      return;
    }

    const nextConfig = linkSpec.nextConfig();
    expect(nextConfig.filterByViewId()).toBeUndefined();
    expect(nextConfig.visibleFieldIds()).toBeUndefined();
    expect(nextConfig.filter()).toBeUndefined();
  });

  it('keeps link filter options when replaceOptions is disabled', () => {
    const baseId = createBaseId('e');
    const hostTableId = createTableId('e');
    const foreignTableId = createTableId('f');
    const foreignPrimaryId = createFieldId('g');
    const foreignStatusId = createFieldId('h');
    const hostPrimaryId = createFieldId('i');
    const linkFieldId = createFieldId('j');

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Link Keep Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignStatusId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      filterByViewId: `viw${'m'.repeat(16)}`,
      visibleFieldIds: [foreignPrimaryId.toString()],
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: foreignStatusId.toString(), operator: 'is', value: 'Active' }],
      },
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Link Keep Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(linkFieldId))
      ._unsafeUnwrap();
    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryId.toString(),
        },
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
    );

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }

    const linkSpec = specsResult.value.find(
      (spec): spec is UpdateLinkConfigSpec => spec instanceof UpdateLinkConfigSpec
    );
    expect(linkSpec).toBeDefined();
    if (!linkSpec) {
      return;
    }

    const nextConfig = linkSpec.nextConfig();
    expect(nextConfig.filterByViewId()?.toString()).toBe(`viw${'m'.repeat(16)}`);
    expect(nextConfig.visibleFieldIds()?.map((id) => id.toString())).toEqual([
      foreignPrimaryId.toString(),
    ]);
    expect(nextConfig.filter()).toEqual({
      conjunction: 'and',
      filterSet: [{ fieldId: foreignStatusId.toString(), operator: 'is', value: 'Active' }],
    });
  });
});
