import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { DbTableName } from '../domain/table/DbTableName';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { CellValueMultiplicity } from '../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../domain/table/fields/types/CellValueType';
import { ConditionalLookupOptions } from '../domain/table/fields/types/ConditionalLookupOptions';
import { ConditionalRollupConfig } from '../domain/table/fields/types/ConditionalRollupConfig';
import { ConditionalRollupField } from '../domain/table/fields/types/ConditionalRollupField';
import { DateTimeFormatting } from '../domain/table/fields/types/DateTimeFormatting';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../domain/table/fields/types/FormulaField';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { LookupOptions } from '../domain/table/fields/types/LookupOptions';
import { MultipleSelectField } from '../domain/table/fields/types/MultipleSelectField';
import { RollupExpression } from '../domain/table/fields/types/RollupExpression';
import { SelectAutoNewOptions } from '../domain/table/fields/types/SelectAutoNewOptions';
import { SelectDefaultValue } from '../domain/table/fields/types/SelectDefaultValue';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import { FieldValueTypeVisitor } from '../domain/table/fields/visitors/FieldValueTypeVisitor';
import { UpdateLinkConfigSpec } from '../domain/table/specs/field-updates/UpdateLinkConfigSpec';
import { UpdateLookupOptionsSpec } from '../domain/table/specs/field-updates/UpdateLookupOptionsSpec';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { buildUpdateFieldSpecs, parseUpdateFieldSpec } from './TableFieldUpdateSpecs';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createContextWithSelectOptionLimit = (maxChoicesPerField: number): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
  config: {
    selectFieldOptions: {
      maxChoicesPerField,
    },
  },
});
const createSelectOption = (id: string, name: string, color: string) =>
  SelectOption.create({ id, name, color })._unsafeUnwrap();

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

  it('bypasses select option limit during type conversion to select field', () => {
    const baseId = createBaseId('y');
    const tableId = createTableId('y');
    const targetFieldId = createFieldId('z');

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Type Conversion Limit')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(createFieldId('w'))
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

    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'singleSelect',
        options: ['Todo', 'Doing'],
      },
      {
        hostTable: table,
        executionContext: createContextWithSelectOptionLimit(1),
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

    const newField = typeSpec.newField();
    expect(newField.type().toString()).toBe('singleSelect');
    expect(newField).toBeInstanceOf(SingleSelectField);
    expect((newField as SingleSelectField).selectOptions()).toHaveLength(2);
  });

  it('preserves select option metadata when converting singleSelect to multipleSelect', () => {
    const baseId = createBaseId('m');
    const tableId = createTableId('m');
    const targetFieldId = createFieldId('n');
    const optionOpen = createSelectOption('optOpen0000000001', 'Open', 'blueBright');
    const optionClosed = createSelectOption('optClosed00000001', 'Closed', 'redBright');
    const optionUnused = createSelectOption('optUnused00000001', 'Unused', 'grayBright');

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Select Conversion')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(createFieldId('o'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .singleSelect()
      .withId(targetFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([optionOpen, optionClosed, optionUnused])
      .withDefaultValue(SelectDefaultValue.create('Open')._unsafeUnwrap())
      .withPreventAutoNewOptions(SelectAutoNewOptions.create(true)._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const currentField = table
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();

    const specsResult = buildUpdateFieldSpecs(
      currentField,
      { type: 'multipleSelect' },
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

    const newField = typeSpec.newField();
    expect(newField).toBeInstanceOf(MultipleSelectField);
    expect(
      (newField as MultipleSelectField).selectOptions().map((option) => option.toDto())
    ).toEqual([optionOpen, optionClosed, optionUnused].map((option) => option.toDto()));
    expect((newField as MultipleSelectField).defaultValue()?.toDto()).toEqual(['Open']);
    expect((newField as MultipleSelectField).preventAutoNewOptions().toBoolean()).toBe(true);
  });

  it('preserves select option metadata when converting multipleSelect to singleSelect', () => {
    const baseId = createBaseId('u');
    const tableId = createTableId('u');
    const targetFieldId = createFieldId('v');
    const optionOpen = createSelectOption('optOpen0000000002', 'Open', 'blueBright');
    const optionClosed = createSelectOption('optClosed00000002', 'Closed', 'redBright');
    const optionUnused = createSelectOption('optUnused00000002', 'Unused', 'grayBright');

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Multi Select Conversion')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(createFieldId('w'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .multipleSelect()
      .withId(targetFieldId)
      .withName(FieldName.create('Tags')._unsafeUnwrap())
      .withOptions([optionOpen, optionClosed, optionUnused])
      .withDefaultValue(SelectDefaultValue.create(['Closed'])._unsafeUnwrap())
      .withPreventAutoNewOptions(SelectAutoNewOptions.create(true)._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const currentField = table
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();

    const specsResult = buildUpdateFieldSpecs(
      currentField,
      { type: 'singleSelect' },
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

    const newField = typeSpec.newField();
    expect(newField).toBeInstanceOf(SingleSelectField);
    expect((newField as SingleSelectField).selectOptions().map((option) => option.toDto())).toEqual(
      [optionOpen, optionClosed, optionUnused].map((option) => option.toDto())
    );
    expect((newField as SingleSelectField).defaultValue()?.toDto()).toBe('Closed');
    expect((newField as SingleSelectField).preventAutoNewOptions().toBoolean()).toBe(true);
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

    const newFieldResult = specResult.value.createField({
      baseId: hostTable.baseId(),
      tableId: hostTable.id(),
    });
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

    const newFieldResult = specResult.value.createField({
      baseId: hostTable.baseId(),
      tableId: hostTable.id(),
    });
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

    const newFieldResult = specResult.value.createField({
      baseId: hostTable.baseId(),
      tableId: hostTable.id(),
    });
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

  it('defaults lookupFieldId to the new foreign table primary field when lookup foreignTableId changes', () => {
    const baseId = createBaseId('1');
    const hostTableId = createTableId('1');
    const foreignTableAId = createTableId('2');
    const foreignTableBId = createTableId('3');
    const foreignPrimaryAId = createFieldId('4');
    const foreignPrimaryBId = createFieldId('5');
    const hostPrimaryId = createFieldId('6');
    const linkFieldId = createFieldId('7');
    const lookupFieldId = createFieldId('8');

    const foreignABuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableAId)
      .withName(TableName.create('Lookup Foreign A')._unsafeUnwrap());
    foreignABuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryAId)
      .withName(FieldName.create('Name A')._unsafeUnwrap())
      .primary()
      .done();
    foreignABuilder.view().defaultGrid().done();
    const foreignTableA = foreignABuilder.build()._unsafeUnwrap();

    const foreignBBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableBId)
      .withName(TableName.create('Lookup Foreign B')._unsafeUnwrap());
    foreignBBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryBId)
      .withName(FieldName.create('Name B')._unsafeUnwrap())
      .primary()
      .done();
    foreignBBuilder.view().defaultGrid().done();
    const foreignTableB = foreignBBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableAId.toString(),
      lookupFieldId: foreignPrimaryAId.toString(),
    })._unsafeUnwrap();

    const lookupOptions = LookupOptions.create({
      linkFieldId: linkFieldId.toString(),
      foreignTableId: foreignTableAId.toString(),
      lookupFieldId: foreignPrimaryAId.toString(),
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Lookup Foreign Switch Host')._unsafeUnwrap());
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
          id: createFieldId('9'),
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
          foreignTableId: foreignTableBId.toString(),
        },
      },
      {
        hostTable,
        foreignTables: [foreignTableA, foreignTableB],
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

    expect(lookupSpec.nextOptions().foreignTableId().equals(foreignTableBId)).toBe(true);
    expect(lookupSpec.nextOptions().lookupFieldId().equals(foreignPrimaryBId)).toBe(true);
  });

  it('forces a lookup options spec when replaceOptions clears showAs without changing other options', () => {
    const baseId = createBaseId('a');
    const hostTableId = createTableId('a');
    const foreignTableId = createTableId('b');
    const foreignPrimaryId = createFieldId('c');
    const hostPrimaryId = createFieldId('d');
    const linkFieldId = createFieldId('e');
    const lookupFieldId = createFieldId('f');

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
          id: createFieldId('g'),
          name: FieldName.create('Inner')._unsafeUnwrap(),
          showAs: { type: 'email' },
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

    expect(specsResult.value).toHaveLength(1);
    expect(specsResult.value[0]).toBeInstanceOf(UpdateLookupOptionsSpec);
    const lookupSpec = specsResult.value[0] as UpdateLookupOptionsSpec;
    expect(lookupSpec.previousOptions().equals(lookupSpec.nextOptions())).toBe(true);
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

  it('returns an error when conditional lookup updates innerOptions without an innerType', () => {
    const baseId = createBaseId('o');
    const hostTableId = createTableId('o');
    const foreignTableId = createTableId('p');
    const hostPrimaryId = createFieldId('q');
    const hostStatusId = createFieldId('r');
    const conditionalLookupFieldId = createFieldId('s');
    const foreignPrimaryId = createFieldId('t');

    const conditionalLookupOptions = ConditionalLookupOptions.create({
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      condition: {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: hostStatusId.toString(), operator: 'is', value: 'active' }],
        },
      },
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Conditional Lookup Missing InnerType')._unsafeUnwrap());
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
          innerOptions: {
            expression: 'NOW()',
          },
        },
      },
      { hostTable }
    );

    expect(specsResult.isErr()).toBe(true);
    expect(specsResult._unsafeUnwrapErr().message).toContain('innerType is required');
  });

  it('returns an error when conditional lookup formula inference is missing innerOptions', () => {
    const baseId = createBaseId('u');
    const hostTableId = createTableId('u');
    const foreignTableId = createTableId('v');
    const hostPrimaryId = createFieldId('w');
    const hostStatusId = createFieldId('x');
    const conditionalLookupFieldId = createFieldId('y');
    const foreignPrimaryId = createFieldId('z');

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Conditional Lookup Foreign For Missing Options')._unsafeUnwrap());
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
      },
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Conditional Lookup Missing InnerOptions')._unsafeUnwrap());
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
        },
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
    );

    expect(specsResult.isErr()).toBe(true);
    expect(specsResult._unsafeUnwrapErr().message).toContain('innerOptions are required');
  });

  it('returns an error when conditional lookup formula inference is missing expression', () => {
    const baseId = createBaseId('a');
    const hostTableId = createTableId('a');
    const foreignTableId = createTableId('b');
    const hostPrimaryId = createFieldId('c');
    const hostStatusId = createFieldId('d');
    const conditionalLookupFieldId = createFieldId('e');
    const foreignPrimaryId = createFieldId('f');

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(
        TableName.create('Conditional Lookup Foreign For Missing Expression')._unsafeUnwrap()
      );
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
      },
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Conditional Lookup Missing Expression')._unsafeUnwrap());
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
          innerOptions: {},
        },
      },
      {
        hostTable,
        foreignTables: [foreignTable],
      }
    );

    expect(specsResult.isErr()).toBe(true);
    expect(specsResult._unsafeUnwrapErr().message).toContain('innerOptions.expression is required');
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

  it('defaults link lookupFieldId to the new foreign table primary field when foreignTableId changes', () => {
    const baseId = createBaseId('h');
    const hostTableId = createTableId('h');
    const foreignTableAId = createTableId('i');
    const foreignTableBId = createTableId('j');
    const foreignPrimaryAId = createFieldId('k');
    const foreignPrimaryBId = createFieldId('l');
    const hostPrimaryId = createFieldId('m');
    const linkFieldId = createFieldId('n');

    const foreignABuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableAId)
      .withName(TableName.create('Link Foreign A')._unsafeUnwrap());
    foreignABuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryAId)
      .withName(FieldName.create('Name A')._unsafeUnwrap())
      .primary()
      .done();
    foreignABuilder.view().defaultGrid().done();
    const foreignTableA = foreignABuilder.build()._unsafeUnwrap();

    const foreignBBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableBId)
      .withName(TableName.create('Link Foreign B')._unsafeUnwrap());
    foreignBBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryBId)
      .withName(FieldName.create('Name B')._unsafeUnwrap())
      .primary()
      .done();
    foreignBBuilder.view().defaultGrid().done();
    const foreignTableB = foreignBBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableAId.toString(),
      lookupFieldId: foreignPrimaryAId.toString(),
    })._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Link Foreign Switch Host')._unsafeUnwrap());
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
      ._unsafeUnwrap() as LinkField;
    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTableBId.toString(),
        },
      },
      {
        hostTable,
        foreignTables: [foreignTableA, foreignTableB],
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

    const nextField = typeSpec.newField() as LinkField;
    expect(nextField.foreignTableId().equals(foreignTableBId)).toBe(true);
    expect(nextField.lookupFieldId().equals(foreignPrimaryBId)).toBe(true);
  });

  it('fills link lookupFieldId from the foreign primary during type conversion', () => {
    const baseId = createBaseId('u');
    const hostTableId = createTableId('u');
    const foreignTableId = createTableId('v');
    const targetFieldId = createFieldId('w');
    const foreignPrimaryFieldId = createFieldId('x');

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Link Conversion Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('y'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .singleLineText()
      .withId(targetFieldId)
      .withName(FieldName.create('Convert Me')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Link Conversion Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryFieldId)
      .withName(FieldName.create('Foreign Primary')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();

    const specResult = parseUpdateFieldSpec(
      currentField,
      {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTableId.toString(),
        },
      },
      {
        foreignTables: [foreignTable],
      }
    );

    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) {
      return;
    }

    const newFieldResult = specResult.value.createField({
      baseId: hostTable.baseId(),
      tableId: hostTable.id(),
    });
    expect(newFieldResult.isOk()).toBe(true);
    if (newFieldResult.isErr()) {
      return;
    }

    expect(newFieldResult.value.type().toString()).toBe('link');
    expect((newFieldResult.value as LinkField).lookupFieldId().equals(foreignPrimaryFieldId)).toBe(
      true
    );
  });

  it('uses the host table dbTableName when converting text to manyOne link', () => {
    const baseId = createBaseId('g');
    const hostTableId = createTableId('g');
    const foreignTableId = createTableId('h');
    const targetFieldId = createFieldId('i');
    const foreignPrimaryFieldId = createFieldId('j');

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withDbTableName(DbTableName.rehydrate(`${baseId.toString()}.enrollments`)._unsafeUnwrap())
      .withName(TableName.create('Enrollments')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('k'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .singleLineText()
      .withId(targetFieldId)
      .withName(FieldName.create('Student')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withDbTableName(DbTableName.rehydrate(`${baseId.toString()}.students`)._unsafeUnwrap())
      .withName(TableName.create('Students')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const currentField = hostTable
      .getField((field) => field.id().equals(targetFieldId))
      ._unsafeUnwrap();

    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTableId.toString(),
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

    const newField = typeSpec.newField() as LinkField;
    expect(newField.fkHostTableNameString()._unsafeUnwrap()).toBe(
      `${baseId.toString()}.enrollments`
    );
  });

  it.each([
    {
      name: 'missing options',
      input: {
        type: 'rollup',
        config: {
          linkFieldId: `fld${'l'.repeat(16)}`,
          foreignTableId: `tbl${'m'.repeat(16)}`,
          lookupFieldId: `fld${'n'.repeat(16)}`,
        },
      },
      expectedMessage: 'options are required',
    },
    {
      name: 'missing config',
      input: {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
      },
      expectedMessage: 'config is required',
    },
    {
      name: 'missing expression',
      input: {
        type: 'rollup',
        options: {},
        config: {
          linkFieldId: `fld${'l'.repeat(16)}`,
          foreignTableId: `tbl${'m'.repeat(16)}`,
          lookupFieldId: `fld${'n'.repeat(16)}`,
        },
      },
      expectedMessage: 'options.expression is required',
    },
    {
      name: 'missing foreign tables',
      input: {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        config: {
          linkFieldId: `fld${'l'.repeat(16)}`,
          foreignTableId: `tbl${'m'.repeat(16)}`,
          lookupFieldId: `fld${'n'.repeat(16)}`,
        },
      },
      expectedMessage: 'foreign tables not loaded',
    },
  ])(
    'returns a derivation error for rollup conversion when $name',
    ({ input, expectedMessage }) => {
      const hostBuilder = Table.builder()
        .withBaseId(createBaseId('b'))
        .withId(createTableId('b'))
        .withName(TableName.create('Rollup Error Host')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(createFieldId('c'))
        .withName(FieldName.create('Primary')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .date()
        .withId(createFieldId('d'))
        .withName(FieldName.create('Target')._unsafeUnwrap())
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();
      const currentField = hostTable
        .getField((field) => field.id().equals(createFieldId('d')))
        ._unsafeUnwrap();

      const specResult = parseUpdateFieldSpec(currentField, input);

      expect(specResult.isErr()).toBe(true);
      expect(specResult._unsafeUnwrapErr().message).toContain(expectedMessage);
    }
  );

  it('returns a derivation error when the rollup foreign table is missing', () => {
    const hostBuilder = Table.builder()
      .withBaseId(createBaseId('e'))
      .withId(createTableId('e'))
      .withName(TableName.create('Rollup Foreign Error Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('f'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .date()
      .withId(createFieldId('g'))
      .withName(FieldName.create('Target')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();
    const currentField = hostTable
      .getField((field) => field.id().equals(createFieldId('g')))
      ._unsafeUnwrap();

    const unrelatedForeignBuilder = Table.builder()
      .withBaseId(createBaseId('h'))
      .withId(createTableId('h'))
      .withName(TableName.create('Unrelated Foreign')._unsafeUnwrap());
    unrelatedForeignBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('i'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    unrelatedForeignBuilder.view().defaultGrid().done();
    const unrelatedForeignTable = unrelatedForeignBuilder.build()._unsafeUnwrap();

    const specResult = parseUpdateFieldSpec(
      currentField,
      {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
        },
        config: {
          linkFieldId: createFieldId('j').toString(),
          foreignTableId: createTableId('k').toString(),
          lookupFieldId: createFieldId('l').toString(),
        },
      },
      {
        foreignTables: [unrelatedForeignTable],
      }
    );

    expect(specResult.isErr()).toBe(true);
    expect(specResult._unsafeUnwrapErr().message).toContain('foreign table not found');
  });

  it('returns a derivation error when the rollup lookup field is missing', () => {
    const baseId = createBaseId('l');
    const hostTableId = createTableId('l');
    const foreignTableId = createTableId('m');
    const targetFieldId = createFieldId('n');
    const foreignPrimaryFieldId = createFieldId('o');
    const missingLookupFieldId = createFieldId('p');

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Rollup Missing Lookup Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('q'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .date()
      .withId(targetFieldId)
      .withName(FieldName.create('Target')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Rollup Missing Lookup Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryFieldId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
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
          linkFieldId: createFieldId('r').toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: missingLookupFieldId.toString(),
        },
      },
      {
        foreignTables: [foreignTable],
      }
    );

    expect(specResult.isErr()).toBe(true);
    expect(specResult._unsafeUnwrapErr().message).toContain('lookup field not found');
  });

  it('derives conditional rollup resultType for type conversion when cellValueType is omitted', () => {
    const baseId = createBaseId('s');
    const hostTableId = createTableId('s');
    const foreignTableId = createTableId('t');
    const targetFieldId = createFieldId('u');
    const foreignPrimaryFieldId = createFieldId('v');
    const foreignNumberFieldId = createFieldId('w');

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Conditional Rollup Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('x'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .date()
      .withId(targetFieldId)
      .withName(FieldName.create('Target')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Conditional Rollup Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryFieldId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
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
        type: 'conditionalRollup',
        options: {
          expression: 'countall({values})',
        },
        config: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignNumberFieldId.toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [],
            },
          },
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

    const valueTypeResult = newFieldResult.value.accept(new FieldValueTypeVisitor());
    expect(valueTypeResult.isOk()).toBe(true);
    if (valueTypeResult.isErr()) {
      return;
    }

    expect(valueTypeResult.value.cellValueType.toString()).toBe('number');
    expect(valueTypeResult.value.isMultipleCellValue.toBoolean()).toBe(false);
  });

  it('clears sort and limit when conditional rollup expression becomes single-value aggregation', () => {
    const baseId = createBaseId('g');
    const hostTableId = createTableId('g');
    const foreignTableId = createTableId('h');
    const targetFieldId = createFieldId('i');
    const foreignPrimaryFieldId = createFieldId('j');
    const foreignDateFieldId = createFieldId('k');

    const hostBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(hostTableId)
      .withName(TableName.create('Conditional Rollup Sort Clear Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(createFieldId('l'))
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder
      .field()
      .date()
      .withId(targetFieldId)
      .withName(FieldName.create('Target')._unsafeUnwrap())
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withBaseId(baseId)
      .withId(foreignTableId)
      .withName(TableName.create('Conditional Rollup Sort Clear Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryFieldId)
      .withName(FieldName.create('Primary')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .date()
      .withId(foreignDateFieldId)
      .withName(FieldName.create('Due Date')._unsafeUnwrap())
      .withFormatting(
        DateTimeFormatting.create({
          date: 'YYYY-MM-DD',
          time: 'HH:mm',
          timeZone: 'utc',
        })._unsafeUnwrap()
      )
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const currentField = ConditionalRollupField.createPending({
      id: targetFieldId,
      name: FieldName.create('Target')._unsafeUnwrap(),
      config: ConditionalRollupConfig.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignDateFieldId.toString(),
        condition: {
          filter: { conjunction: 'and', filterSet: [] },
          sort: { fieldId: foreignDateFieldId.toString(), order: 'desc' },
          limit: 10,
        },
      })._unsafeUnwrap(),
      expression: RollupExpression.create('countall({values})')._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();

    const specsResult = buildUpdateFieldSpecs(
      currentField,
      {
        type: 'conditionalRollup',
        options: {
          expression: 'max({values})',
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

    const nextField = typeSpec.newField() as ConditionalRollupField;
    expect(nextField.config().condition().hasSort()).toBe(false);
    expect(nextField.config().condition().hasLimit()).toBe(false);
    const valueTypeResult = nextField.accept(new FieldValueTypeVisitor());
    expect(valueTypeResult.isOk()).toBe(true);
    if (valueTypeResult.isErr()) {
      return;
    }
    expect(valueTypeResult.value.cellValueType.toString()).toBe('dateTime');
    expect(valueTypeResult.value.isMultipleCellValue.toBoolean()).toBe(false);
  });
});
