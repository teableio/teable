import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import { FieldName } from '../domain/table/fields/FieldName';
import { FieldNotNull } from '../domain/table/fields/types/FieldNotNull';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { SelectDefaultValue } from '../domain/table/fields/types/SelectDefaultValue';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { TextDefaultValue } from '../domain/table/fields/types/TextDefaultValue';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import { TableUpdateViewColumnMetaSpec } from '../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import { ViewType } from '../domain/table/views/ViewType';
import { buildUpdateFieldSpecs } from './TableFieldUpdateSpecs';

const visibleOf = (table: Table, fieldName: string): boolean | undefined => {
  const field = table.getFields().find((item) => item.name().toString() === fieldName);
  const form = table.views().find((view) => view.type().equals(ViewType.form()));
  if (!field || !form) throw new Error('missing field or form view');
  return form.columnMeta()._unsafeUnwrap().toDto()[field.id().toString()]?.visible;
};

describe('buildUpdateFieldSpecs form visibility', () => {
  it('shows a hidden required field with no default and keeps a defaulted field hidden', () => {
    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Form visibility')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder.field().singleLineText().withName(FieldName.create('X')._unsafeUnwrap()).done();
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Y')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('abc')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    builder.view().form().defaultName().done();

    let table = builder.build()._unsafeUnwrap();
    for (const field of table.getFields()) {
      field.setDbFieldName(DbFieldName.rehydrate(field.name().toString())._unsafeUnwrap());
    }
    const form = table.views().find((view) => view.type().equals(ViewType.form()))!;
    const hidden = table
      .updateViewColumnMeta(form.id(), [
        {
          fieldId: table
            .getFields()
            .find((field) => field.name().toString() === 'X')!
            .id(),
          columnMeta: { visible: false },
        },
        {
          fieldId: table
            .getFields()
            .find((field) => field.name().toString() === 'Y')!
            .id(),
          columnMeta: { visible: false },
        },
      ])
      ._unsafeUnwrap();
    table = hidden.updateResult!.table;

    const fieldX = table.getFields().find((field) => field.name().toString() === 'X')!;
    const fieldY = table.getFields().find((field) => field.name().toString() === 'Y')!;

    const xSpecs = buildUpdateFieldSpecs(
      fieldX,
      { notNull: true },
      { hostTable: table }
    )._unsafeUnwrap();
    expect(xSpecs.some((spec) => spec instanceof TableUpdateViewColumnMetaSpec)).toBe(true);
    table = table.updateFieldWithSpecs(fieldX.id(), xSpecs)._unsafeUnwrap().updateResult.table;
    expect(visibleOf(table, 'X')).toBe(true);
    expect(visibleOf(table, 'Y')).toBe(false);

    const currentY = table.getFields().find((field) => field.name().toString() === 'Y')!;
    const ySpecs = buildUpdateFieldSpecs(
      currentY,
      { notNull: true },
      { hostTable: table }
    )._unsafeUnwrap();
    expect(ySpecs.some((spec) => spec instanceof TableUpdateViewColumnMetaSpec)).toBe(false);
    table = table.updateFieldWithSpecs(currentY.id(), ySpecs)._unsafeUnwrap().updateResult.table;
    expect(visibleOf(table, 'X')).toBe(true);
    expect(visibleOf(table, 'Y')).toBe(false);
    expect(
      table
        .getFields()
        .find((field) => field.name().toString() === 'Y')!
        .notNull()
        .toBoolean()
    ).toBe(true);
  });

  it('shows a hidden link field that becomes required while retargeting its foreign table', () => {
    const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
    const foreignA = Table.builder()
      .withBaseId(baseId)
      .withName(TableName.create('Foreign A')._unsafeUnwrap());
    foreignA
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    foreignA.view().defaultGrid().done();
    const tableA = foreignA.build()._unsafeUnwrap();

    const foreignB = Table.builder()
      .withBaseId(baseId)
      .withName(TableName.create('Foreign B')._unsafeUnwrap());
    foreignB
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    foreignB.view().defaultGrid().done();
    const tableB = foreignB.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: tableA.id().toString(),
      lookupFieldId: tableA.primaryFieldId().toString(),
      isOneWay: true,
    })._unsafeUnwrap();

    const host = Table.builder()
      .withBaseId(baseId)
      .withName(TableName.create('Host')._unsafeUnwrap());
    host
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    host
      .field()
      .link()
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    host.view().defaultGrid().done();
    host.view().form().defaultName().done();

    let table = host.build()._unsafeUnwrap();
    for (const field of table.getFields()) {
      field.setDbFieldName(DbFieldName.rehydrate(field.name().toString())._unsafeUnwrap());
    }
    const link = table.getFields().find((field) => field.name().toString() === 'Link')!;
    const form = table.views().find((view) => view.type().equals(ViewType.form()))!;
    table = table
      .updateViewColumnMeta(form.id(), [{ fieldId: link.id(), columnMeta: { visible: false } }])
      ._unsafeUnwrap().updateResult!.table;

    const currentLink = table.getFields().find((field) => field.name().toString() === 'Link')!;
    const specs = buildUpdateFieldSpecs(
      currentLink,
      {
        notNull: true,
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id().toString(),
          lookupFieldId: tableB.primaryFieldId().toString(),
          isOneWay: true,
        },
      },
      { hostTable: table, foreignTables: [tableA, tableB] }
    )._unsafeUnwrap();
    const typeSpec = specs.find(
      (spec): spec is TableUpdateFieldTypeSpec => spec instanceof TableUpdateFieldTypeSpec
    );
    expect(typeSpec?.newField().notNull().toBoolean()).toBe(false);

    expect(specs.some((spec) => spec instanceof TableUpdateViewColumnMetaSpec)).toBe(true);
    table = table
      .updateFieldWithSpecs(currentLink.id(), specs, { foreignTables: [tableA, tableB] })
      ._unsafeUnwrap().updateResult.table;
    expect(visibleOf(table, 'Link')).toBe(true);
    expect(
      table
        .getFields()
        .find((field) => field.name().toString() === 'Link')!
        .notNull()
        .toBoolean()
    ).toBe(true);
  });

  it('shows an already required hidden select after its default choice is deleted', () => {
    const choiceA = SelectOption.create({ name: 'A', color: 'blue' })._unsafeUnwrap();
    const choiceB = SelectOption.create({ name: 'B', color: 'green' })._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Select visibility')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .singleSelect()
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([choiceA, choiceB])
      .withDefaultValue(SelectDefaultValue.create('A')._unsafeUnwrap())
      .withNotNull(FieldNotNull.required())
      .done();
    builder.view().defaultGrid().done();
    builder.view().form().defaultName().done();

    let table = builder.build()._unsafeUnwrap();
    for (const field of table.getFields()) {
      field.setDbFieldName(DbFieldName.rehydrate(field.name().toString())._unsafeUnwrap());
    }
    const status = table.getFields().find((field) => field.name().toString() === 'Status')!;
    const form = table.views().find((view) => view.type().equals(ViewType.form()))!;
    table = table
      .updateViewColumnMeta(form.id(), [{ fieldId: status.id(), columnMeta: { visible: false } }])
      ._unsafeUnwrap().updateResult!.table;

    const currentStatus = table.getFields().find((field) => field.name().toString() === 'Status')!;
    const specs = buildUpdateFieldSpecs(
      currentStatus,
      {
        options: {
          choices: [{ id: choiceB.id().toString(), name: 'B', color: 'green' }],
        },
      },
      { hostTable: table }
    )._unsafeUnwrap();

    expect(specs.some((spec) => spec instanceof TableUpdateViewColumnMetaSpec)).toBe(true);
    table = table.updateFieldWithSpecs(currentStatus.id(), specs)._unsafeUnwrap()
      .updateResult.table;
    expect(visibleOf(table, 'Status')).toBe(true);
  });

  it('keeps a required text field optional and hidden when converted with notNull false', () => {
    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Conversion visibility')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Note')._unsafeUnwrap())
      .withDefaultValue(TextDefaultValue.create('abc')._unsafeUnwrap())
      .withNotNull(FieldNotNull.required())
      .done();
    builder.view().defaultGrid().done();
    builder.view().form().defaultName().done();

    let table = builder.build()._unsafeUnwrap();
    for (const field of table.getFields()) {
      field.setDbFieldName(DbFieldName.rehydrate(field.name().toString())._unsafeUnwrap());
    }
    const note = table.getFields().find((field) => field.name().toString() === 'Note')!;
    const form = table.views().find((view) => view.type().equals(ViewType.form()))!;
    table = table
      .updateViewColumnMeta(form.id(), [{ fieldId: note.id(), columnMeta: { visible: false } }])
      ._unsafeUnwrap().updateResult!.table;

    const currentNote = table.getFields().find((field) => field.name().toString() === 'Note')!;
    const specs = buildUpdateFieldSpecs(
      currentNote,
      { type: 'longText', notNull: false },
      { hostTable: table }
    )._unsafeUnwrap();
    const typeSpec = specs.find(
      (spec): spec is TableUpdateFieldTypeSpec => spec instanceof TableUpdateFieldTypeSpec
    );
    expect(typeSpec?.newField().notNull().toBoolean()).toBe(false);

    expect(specs.some((spec) => spec instanceof TableUpdateViewColumnMetaSpec)).toBe(false);
    table = table.updateFieldWithSpecs(currentNote.id(), specs)._unsafeUnwrap().updateResult.table;
    const converted = table.getFields().find((field) => field.name().toString() === 'Note')!;
    expect(converted.notNull().toBoolean()).toBe(false);
    expect(converted.type().toString()).toBe('longText');
    expect(visibleOf(table, 'Note')).toBe(false);
  });
});
