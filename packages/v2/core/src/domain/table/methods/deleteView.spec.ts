import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewDeleted } from '../events/ViewDeleted';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { LinkField } from '../fields/types/LinkField';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { TableRemoveViewSpec } from '../specs/TableRemoveViewSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const viewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`)._unsafeUnwrap();

const buildTable = (seed: string): Table => {
  const builder = Table.builder()
    .withId(tableId(seed))
    .withBaseId(baseId)
    .withName(TableName.create(`Table ${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(fieldId(seed))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.deleteView', () => {
  it('removes an owned View and produces a mutation spec plus domain event', () => {
    const table = buildTable('b');
    const created = table.createView({ type: 'kanban', name: 'Delivery' })._unsafeUnwrap();
    const targetViewId = created.view.id();
    const tableWithTwoViews = created.updateResult.table;
    tableWithTwoViews.pullDomainEvents();

    const result = tableWithTwoViews.deleteView(targetViewId)._unsafeUnwrap();

    expect(result.deletedView.id().equals(targetViewId)).toBe(true);
    expect(result.updateResult.mutateSpec).toBeInstanceOf(TableRemoveViewSpec);
    expect(result.updateResult.table.views()).toHaveLength(1);
    expect(result.updateResult.table.getView(targetViewId)._unsafeUnwrapErr().code).toBe(
      'view.not_found'
    );
    const [event] = result.updateResult.table.pullDomainEvents();
    expect(event).toBeInstanceOf(ViewDeleted);
    expect((event as ViewDeleted).viewId.equals(targetViewId)).toBe(true);
  });

  it('checks the last-View invariant before looking up the target View', () => {
    const result = buildTable('c').deleteView(viewId('z'));

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'view.cannot_delete_last',
      message: 'Cannot delete the last view in a table. A table must have at least one view.',
    });
  });

  it('rejects a missing View when another View keeps the aggregate valid', () => {
    const first = buildTable('d');
    const table = first.createView({ type: 'gallery' })._unsafeUnwrap().updateResult.table;

    expect(table.deleteView(viewId('y'))._unsafeUnwrapErr().code).toBe('view.not_found');
  });

  it('returns the cross-aggregate Link cleanup plan owned by the source Table', () => {
    const foreignTable = buildTable('e');
    const symmetricFieldId = fieldId('f');
    const builder = Table.builder()
      .withId(tableId('g'))
      .withBaseId(baseId)
      .withName(TableName.create('Source')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(fieldId('g'))
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(fieldId('h'))
      .withName(FieldName.create('Foreign')._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignTable.primaryFieldId().toString(),
          symmetricFieldId: symmetricFieldId.toString(),
          isOneWay: false,
        })._unsafeUnwrap()
      )
      .done();
    builder
      .field()
      .link()
      .withId(fieldId('i'))
      .withName(FieldName.create('One way')._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignTable.primaryFieldId().toString(),
          isOneWay: true,
        })._unsafeUnwrap()
      )
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap().createView({ type: 'grid' })._unsafeUnwrap()
      .updateResult.table;
    const targetViewId = table.views()[1]!.id();

    const result = table.deleteView(targetViewId)._unsafeUnwrap();

    expect(result.linkDependencies).toHaveLength(1);
    expect(result.linkDependencies[0]!.foreignTableId.equals(foreignTable.id())).toBe(true);
    expect(result.linkDependencies[0]!.symmetricFieldId.equals(symmetricFieldId)).toBe(true);
  });
});

describe('Table.clearViewFilterDependencies', () => {
  it('clears only matching Link filterByViewId values through a Table update spec', () => {
    const referencedViewId = viewId('j');
    const matchingFieldId = fieldId('k');
    const untouchedFieldId = fieldId('l');
    const builder = Table.builder()
      .withId(tableId('m'))
      .withBaseId(baseId)
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(fieldId('m'))
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    for (const [id, filter] of [
      [matchingFieldId, referencedViewId],
      [untouchedFieldId, viewId('n')],
    ] as const) {
      builder
        .field()
        .link()
        .withId(id)
        .withName(FieldName.create(id.toString())._unsafeUnwrap())
        .withConfig(
          LinkFieldConfig.create({
            relationship: 'manyMany',
            foreignTableId: tableId('o').toString(),
            lookupFieldId: fieldId('o').toString(),
            filterByViewId: filter.toString(),
            isOneWay: true,
          })._unsafeUnwrap()
        )
        .done();
    }
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const result = table
      .clearViewFilterDependencies(referencedViewId, [
        matchingFieldId,
        untouchedFieldId,
        fieldId('z'),
      ])
      ._unsafeUnwrap();

    expect(result).toBeDefined();
    const matching = result!.table
      .getField((field) => field.id().equals(matchingFieldId))
      ._unsafeUnwrap();
    const untouched = result!.table
      .getField((field) => field.id().equals(untouchedFieldId))
      ._unsafeUnwrap();
    expect(matching).toBeInstanceOf(LinkField);
    expect((matching as LinkField).filterByViewId()).toBeNull();
    expect((untouched as LinkField).filterByViewId()?.equals(viewId('n'))).toBe(true);
  });

  it('returns no update when no candidate Link Field depends on the View', () => {
    const table = buildTable('p');

    expect(
      table.clearViewFilterDependencies(viewId('q'), [table.primaryFieldId()])._unsafeUnwrap()
    ).toBeUndefined();
  });
});
