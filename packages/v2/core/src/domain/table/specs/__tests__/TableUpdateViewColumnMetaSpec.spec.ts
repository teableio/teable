import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
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
});
