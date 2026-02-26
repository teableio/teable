import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { NumberFormatting, NumberFormattingType } from '../../../fields/types/NumberFormatting';
import { Table } from '../../../Table';
import { TableName } from '../../../TableName';
import { FieldCreated } from '../../../events/FieldCreated';
import { FieldDeleted } from '../../../events/FieldDeleted';
import { FieldUpdated } from '../../../events/FieldUpdated';
import { TableRenamed } from '../../../events/TableRenamed';
import { TableAddFieldSpec } from '../../TableAddFieldSpec';
import { TableRemoveFieldSpec } from '../../TableRemoveFieldSpec';
import { TableRenameSpec } from '../../TableRenameSpec';
import { TableByIdSpec } from '../../TableByIdSpec';
import { TableByBaseIdSpec } from '../../TableByBaseIdSpec';
import { TableUpdateFieldDescriptionSpec } from '../../TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldNameSpec } from '../../TableUpdateFieldNameSpec';
import { TableUpdateFieldTypeSpec } from '../../TableUpdateFieldTypeSpec';
import { UpdateNumberFormattingSpec } from '../../field-updates/UpdateNumberFormattingSpec';
import { TableEventGeneratingSpecVisitor } from '../TableEventGeneratingSpecVisitor';
import { SingleLineTextField } from '../../../fields/types/SingleLineTextField';
import { SingleSelectField } from '../../../fields/types/SingleSelectField';
import { SelectOption } from '../../../fields/types/SelectOption';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildTable = () => {
  const baseId = createBaseId('a');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('TableEventGeneratingSpecVisitor', () => {
  it('generates FieldCreated event for TableAddFieldSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const newFieldId = createFieldId('b');
    const newFieldName = FieldName.create('NewField')._unsafeUnwrap();
    const newField = SingleLineTextField.create({
      id: newFieldId,
      name: newFieldName,
    })._unsafeUnwrap();

    const spec = TableAddFieldSpec.create(newField);
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(FieldCreated);
  });

  it('generates FieldDeleted event for TableRemoveFieldSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const field = table.getFields()[0];
    const spec = TableRemoveFieldSpec.create(field);
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(FieldDeleted);
  });

  it('generates TableRenamed event for TableRenameSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const prevName = TableName.create('Test')._unsafeUnwrap();
    const nextName = TableName.create('Renamed')._unsafeUnwrap();
    const spec = TableRenameSpec.create(prevName, nextName);
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(TableRenamed);
  });

  it('generates FieldUpdated event with name property for TableUpdateFieldNameSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const fieldId = table.getFields()[0].id();
    const prevName = FieldName.create('Title')._unsafeUnwrap();
    const nextName = FieldName.create('Name')._unsafeUnwrap();
    const spec = TableUpdateFieldNameSpec.create(fieldId, prevName, nextName);
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(FieldUpdated);
    expect((events[0] as FieldUpdated).updatedProperties).toContain('name');
    expect((events[0] as FieldUpdated).changes.name).toEqual({
      oldValue: prevName,
      newValue: nextName,
    });
  });

  it('generates FieldUpdated event with description property for TableUpdateFieldDescriptionSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const fieldId = table.getFields()[0].id();
    const spec = TableUpdateFieldDescriptionSpec.create(fieldId, null, 'next description');
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(FieldUpdated);
    expect((events[0] as FieldUpdated).updatedProperties).toContain('description');
    expect((events[0] as FieldUpdated).changes.description).toEqual({
      oldValue: null,
      newValue: 'next description',
    });
  });

  it('generates FieldUpdated event with formatting property for UpdateNumberFormattingSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const fieldId = table.getFields()[0].id();
    const previousFormatting = NumberFormatting.default();
    const nextFormatting = NumberFormatting.create({
      type: NumberFormattingType.Currency,
      precision: 2,
      symbol: '$',
    })._unsafeUnwrap();
    const spec = UpdateNumberFormattingSpec.create(
      fieldId,
      previousFormatting,
      nextFormatting
    );
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(FieldUpdated);
    const fieldUpdated = events[0] as FieldUpdated;
    expect(fieldUpdated.updatedProperties).toContain('formatting');
    expect(fieldUpdated.changes.formatting).toEqual({
      oldValue: previousFormatting,
      newValue: nextFormatting,
    });
  });

  it('generates type conversion event with type and options properties', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const oldField = table.getFields()[0];
    const selectField = SingleSelectField.create({
      id: oldField.id(),
      name: oldField.name(),
      options: [
        SelectOption.create({ id: 'opt1', name: 'Open', color: 'yellowBright' })._unsafeUnwrap(),
      ],
    })._unsafeUnwrap();
    const spec = TableUpdateFieldTypeSpec.create(oldField, selectField);

    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(FieldUpdated);
    const fieldUpdated = events[0] as FieldUpdated;
    expect(fieldUpdated.updatedProperties).toEqual(['type', 'options']);
    expect(fieldUpdated.changes.type).toEqual({
      oldValue: 'singleLineText',
      newValue: 'singleSelect',
    });
    expect(fieldUpdated.changes.options).toEqual({
      oldValue: {},
      newValue: {
        choices: [{ id: 'opt1', name: 'Open', color: 'yellowBright' }],
      },
    });
  });

  it('does not generate events for query specs', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const byIdSpec = TableByIdSpec.create(table.id());
    byIdSpec.accept(visitor)._unsafeUnwrap();

    const byBaseIdSpec = TableByBaseIdSpec.create(table.baseId());
    byBaseIdSpec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(0);
  });

  it('accumulates multiple events', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const prevName = TableName.create('Test')._unsafeUnwrap();
    const nextName = TableName.create('Renamed')._unsafeUnwrap();
    TableRenameSpec.create(prevName, nextName).accept(visitor)._unsafeUnwrap();

    const fieldId = table.getFields()[0].id();
    const prevFieldName = FieldName.create('Title')._unsafeUnwrap();
    const nextFieldName = FieldName.create('Name')._unsafeUnwrap();
    TableUpdateFieldNameSpec.create(fieldId, prevFieldName, nextFieldName)
      .accept(visitor)
      ._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events.length).toBe(2);
    expect(events[0]).toBeInstanceOf(TableRenamed);
    expect(events[1]).toBeInstanceOf(FieldUpdated);
  });
});
