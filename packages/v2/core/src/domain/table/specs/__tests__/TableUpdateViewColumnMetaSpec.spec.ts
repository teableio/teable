import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import { ViewColumnMeta } from '../../views/ViewColumnMeta';
import { ViewName } from '../../views/ViewName';
import { TableUpdateViewColumnMetaSpec } from '../TableUpdateViewColumnMetaSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();

describe('TableUpdateViewColumnMetaSpec', () => {
  it('places duplicated field right after source field in target view', () => {
    const baseId = createBaseId('a');
    const builder = Table.builder()
      .withBaseId(baseId)
      .withName(TableName.create('Duplicate View Order')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
    builder.field().singleLineText().withName(FieldName.create('Note')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    const sourceField = table.getFields().find((field) => field.name().toString() === 'Amount');
    expect(sourceField).toBeTruthy();
    if (!sourceField) return;

    const duplicatedField = sourceField
      .duplicate({
        newId: FieldId.mustGenerate(),
        newName: FieldName.create('Amount (copy)')._unsafeUnwrap(),
        baseId: table.baseId(),
        tableId: table.id(),
      })
      ._unsafeUnwrap();

    const withDuplicated = table.addField(duplicatedField)._unsafeUnwrap();
    const targetView = withDuplicated.views()[0]!;

    const spec = TableUpdateViewColumnMetaSpec.forDuplicatePlacement({
      table: withDuplicated,
      sourceFieldId: sourceField.id(),
      newFieldId: duplicatedField.id(),
      targetViewId: targetView.id(),
    })._unsafeUnwrap();

    const update = spec.updates()[0]!;
    const dto = update.columnMeta.toDto();
    const sourceOrder = dto[sourceField.id().toString()]?.order;
    const duplicatedOrder = dto[duplicatedField.id().toString()]?.order;

    expect(typeof sourceOrder).toBe('number');
    expect(typeof duplicatedOrder).toBe('number');
    expect((duplicatedOrder as number) > (sourceOrder as number)).toBe(true);
  });

  it('keeps non-target view visibility updates while overriding target view placement', () => {
    const baseId = createBaseId('b');
    const builder = Table.builder()
      .withBaseId(baseId)
      .withName(TableName.create('Create Field View Order')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder.field().singleLineText().withName(FieldName.create('Notes')._unsafeUnwrap()).done();
    builder.view().grid().withName(ViewName.create('View A')._unsafeUnwrap()).done();
    builder.view().grid().withName(ViewName.create('View B')._unsafeUnwrap()).done();

    const table = builder.build()._unsafeUnwrap();
    const notesField = table.getFields().find((field) => field.name().toString() === 'Notes');
    const viewA = table.views().find((view) => view.name().toString() === 'View A');
    const viewB = table.views().find((view) => view.name().toString() === 'View B');

    expect(notesField).toBeTruthy();
    expect(viewA).toBeTruthy();
    expect(viewB).toBeTruthy();
    if (!notesField || !viewA || !viewB) return;

    const configuredTable = TableUpdateViewColumnMetaSpec.create([
      {
        viewId: viewA.id(),
        fieldId: notesField.id(),
        columnMeta: ViewColumnMeta.create({
          ...viewA.columnMeta()._unsafeUnwrap().toDto(),
          [notesField.id().toString()]: {
            ...(viewA.columnMeta()._unsafeUnwrap().toDto()[notesField.id().toString()] ?? {}),
            hidden: false,
          },
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();

    const newField = SingleLineTextField.create({
      id: FieldId.mustGenerate(),
      name: FieldName.create('Inserted')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const nextTable = configuredTable
      .addField(newField, {
        targetViewId: viewB.id(),
      })
      ._unsafeUnwrap();

    const spec = TableUpdateViewColumnMetaSpec.forFieldPlacement({
      table: nextTable,
      fieldId: newField.id(),
      targetViewId: viewB.id(),
      order: 2.5,
    })._unsafeUnwrap();

    expect(spec.updates()).toHaveLength(2);

    const viewAUpdate = spec.updates().find((update) => update.viewId.equals(viewA.id()));
    const viewBUpdate = spec.updates().find((update) => update.viewId.equals(viewB.id()));
    expect(viewAUpdate).toBeTruthy();
    expect(viewBUpdate).toBeTruthy();
    if (!viewAUpdate || !viewBUpdate) return;

    expect(viewAUpdate.columnMeta.toDto()[newField.id().toString()]?.hidden).toBe(true);
    expect(viewBUpdate.columnMeta.toDto()[newField.id().toString()]?.hidden).toBeUndefined();
    expect(viewBUpdate.columnMeta.toDto()[newField.id().toString()]?.order).toBe(2.5);
  });
});
