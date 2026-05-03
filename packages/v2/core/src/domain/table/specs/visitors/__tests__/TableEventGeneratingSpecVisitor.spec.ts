import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { FieldCreated } from '../../../events/FieldCreated';
import { FieldDeleted } from '../../../events/FieldDeleted';
import { FieldDuplicated } from '../../../events/FieldDuplicated';
import { FieldOptionsAdded } from '../../../events/FieldOptionsAdded';
import { FieldUpdated } from '../../../events/FieldUpdated';
import { TableRenamed } from '../../../events/TableRenamed';
import { ViewColumnMetaUpdated } from '../../../events/ViewColumnMetaUpdated';
import { DbFieldName } from '../../../fields/DbFieldName';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { FieldNotNull } from '../../../fields/types/FieldNotNull';
import { NumberFormatting, NumberFormattingType } from '../../../fields/types/NumberFormatting';
import { FieldUnique } from '../../../fields/types/FieldUnique';
import { SelectOption } from '../../../fields/types/SelectOption';
import { SingleLineTextField } from '../../../fields/types/SingleLineTextField';
import { SingleSelectField } from '../../../fields/types/SingleSelectField';
import { Table } from '../../../Table';
import { TableName } from '../../../TableName';
import { ViewColumnMeta } from '../../../views/ViewColumnMeta';
import { RemoveSymmetricLinkFieldSpec } from '../../field-updates/RemoveSymmetricLinkFieldSpec';
import { UpdateNumberFormattingSpec } from '../../field-updates/UpdateNumberFormattingSpec';
import { TableAddFieldSpec } from '../../TableAddFieldSpec';
import { TableAddFieldsSpec } from '../../TableAddFieldsSpec';
import { TableAddSelectOptionsSpec } from '../../TableAddSelectOptionsSpec';
import { TableByBaseIdSpec } from '../../TableByBaseIdSpec';
import { TableByIdSpec } from '../../TableByIdSpec';
import { TableByIdsSpec } from '../../TableByIdsSpec';
import { TableByIncomingReferenceToTableSpec } from '../../TableByIncomingReferenceToTableSpec';
import { TableByNameLikeSpec } from '../../TableByNameLikeSpec';
import { TableByNameSpec } from '../../TableByNameSpec';
import { TableDuplicateFieldSpec } from '../../TableDuplicateFieldSpec';
import { TableRemoveFieldSpec } from '../../TableRemoveFieldSpec';
import { TableRenameSpec } from '../../TableRenameSpec';
import { TableUpdateFieldConstraintsSpec } from '../../TableUpdateFieldConstraintsSpec';
import { TableUpdateFieldDescriptionSpec } from '../../TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldNameSpec } from '../../TableUpdateFieldNameSpec';
import { TableUpdateFieldTypeSpec } from '../../TableUpdateFieldTypeSpec';
import { TableUpdateViewColumnMetaSpec } from '../../TableUpdateViewColumnMetaSpec';
import { TableEventGeneratingSpecVisitor } from '../TableEventGeneratingSpecVisitor';

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

  it('generates FieldCreated events for TableAddFieldsSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const firstField = SingleLineTextField.create({
      id: createFieldId('b'),
      name: FieldName.create('First Extra')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const secondField = SingleLineTextField.create({
      id: createFieldId('c'),
      name: FieldName.create('Second Extra')._unsafeUnwrap(),
    })._unsafeUnwrap();

    TableAddFieldsSpec.create([firstField, secondField]).accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(FieldCreated);
    expect(events[1]).toBeInstanceOf(FieldCreated);
  });

  it('generates FieldOptionsAdded only when added options are non-empty', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);
    const fieldId = table.getFields()[0].id();
    const option = SelectOption.create({
      id: 'opt_added',
      name: 'Added',
      color: 'greenBright',
    })._unsafeUnwrap();

    TableAddSelectOptionsSpec.create(fieldId, []).accept(visitor)._unsafeUnwrap();
    TableAddSelectOptionsSpec.create(fieldId, [option]).accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(FieldOptionsAdded);
    expect((events[0] as FieldOptionsAdded).options).toEqual([option.toDto()]);
  });

  it('generates FieldDuplicated and FieldCreated events for TableDuplicateFieldSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);
    const sourceField = table.getFields()[0];
    const newField = SingleLineTextField.create({
      id: createFieldId('d'),
      name: FieldName.create('Title Copy')._unsafeUnwrap(),
    })._unsafeUnwrap();

    TableDuplicateFieldSpec.create(sourceField, newField, true).accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(FieldDuplicated);
    expect((events[0] as FieldDuplicated).sourceFieldId).toEqual(sourceField.id());
    expect((events[0] as FieldDuplicated).newFieldId).toEqual(newField.id());
    expect(events[1]).toBeInstanceOf(FieldCreated);
    expect((events[1] as FieldCreated).fieldId).toEqual(newField.id());
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

  it('generates FieldDeleted event for RemoveSymmetricLinkFieldSpec', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);
    const field = table.getFields()[0];

    RemoveSymmetricLinkFieldSpec.create(field).accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(FieldDeleted);
    expect((events[0] as FieldDeleted).fieldId).toEqual(field.id());
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
    expect((events[0] as FieldUpdated).mayRequirePresence()).toBe(false);
  });

  it('generates ViewColumnMetaUpdated events for each updated view-column pair', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);
    const fieldId = table.getFields()[0].id();
    const viewId = table.views()[0].id();
    const columnMeta = ViewColumnMeta.create({
      [fieldId.toString()]: {
        order: 3,
        hidden: false,
      },
    })._unsafeUnwrap();

    TableUpdateViewColumnMetaSpec.create([
      { viewId, fieldId, columnMeta },
      { viewId, fieldId: createFieldId('e'), columnMeta },
    ])
      .accept(visitor)
      ._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(ViewColumnMetaUpdated);
    expect(events[1]).toBeInstanceOf(ViewColumnMetaUpdated);
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
    const spec = UpdateNumberFormattingSpec.create(fieldId, previousFormatting, nextFormatting);
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
    expect(fieldUpdated.realtimePathFor('formatting')).toEqual(['options']);
    expect(fieldUpdated.presencePathFor('formatting')).toEqual(['options', 'formatting']);
    expect(fieldUpdated.mayRequirePresence()).toBe(true);
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
    expect(fieldUpdated.mayRequirePresence()).toBe(true);
  });

  it('generates constraints event only for changed constraints', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);
    const fieldId = table.getFields()[0].id();

    TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName: DbFieldName.rehydrate('title')._unsafeUnwrap(),
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.required(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.disabled(),
    })
      .accept(visitor)
      ._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(1);
    const fieldUpdated = events[0] as FieldUpdated;
    expect(fieldUpdated.updatedProperties).toEqual(['notNull']);
    expect(fieldUpdated.changes.notNull).toEqual({
      oldValue: FieldNotNull.optional(),
      newValue: FieldNotNull.required(),
    });
  });

  it('does not generate field-updated event when field constraints are unchanged', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);
    const fieldId = table.getFields()[0].id();

    TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName: DbFieldName.rehydrate('title')._unsafeUnwrap(),
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.optional(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.disabled(),
    })
      .accept(visitor)
      ._unsafeUnwrap();

    expect(visitor.getEvents()).toHaveLength(0);
  });

  it('does not generate events for query specs', () => {
    const table = buildTable();
    const visitor = new TableEventGeneratingSpecVisitor(table);

    const byIdSpec = TableByIdSpec.create(table.id());
    byIdSpec.accept(visitor)._unsafeUnwrap();

    const byBaseIdSpec = TableByBaseIdSpec.create(table.baseId());
    byBaseIdSpec.accept(visitor)._unsafeUnwrap();

    const byIncomingReferenceSpec = TableByIncomingReferenceToTableSpec.create(table.id());
    byIncomingReferenceSpec.accept(visitor)._unsafeUnwrap();

    TableByIdsSpec.create([table.id()]).accept(visitor)._unsafeUnwrap();
    TableByNameSpec.create(table.name()).accept(visitor)._unsafeUnwrap();
    TableByNameLikeSpec.create(TableName.create('Tes')._unsafeUnwrap())
      .accept(visitor)
      ._unsafeUnwrap();

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
