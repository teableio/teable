import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const id = (prefix: 'bse' | 'tbl' | 'fld' | 'viw', seed: string) => `${prefix}${seed.repeat(16)}`;

const buildTable = (viewType: 'grid' | 'form' | 'plugin') => {
  const foreignTableId = TableId.create(id('tbl', 'f'))._unsafeUnwrap();
  const lookupFieldId = FieldId.create(id('fld', 'l'))._unsafeUnwrap();
  const primaryFieldId = FieldId.create(id('fld', 'p'))._unsafeUnwrap();
  const linkFieldId = FieldId.create(id('fld', 'k'))._unsafeUnwrap();
  const viewId = ViewId.create(id('viw', 'v'))._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(id('bse', 'b'))._unsafeUnwrap())
    .withId(TableId.create(id('tbl', 't'))._unsafeUnwrap())
    .withName(TableName.create('Host')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Link')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  builder.view()[viewType]().withId(viewId).defaultName().done();
  const table = builder.build()._unsafeUnwrap();
  return { table, viewId, linkFieldId, primaryFieldId, foreignTableId, lookupFieldId };
};

describe('Table.createViewLinkRecordsQueryPlan', () => {
  it('makes Form Link selectors candidate queries regardless of the requested type', () => {
    const fixture = buildTable('form');
    const plan = fixture.table
      .createViewLinkRecordsQueryPlan({
        viewId: fixture.viewId,
        fieldId: fixture.linkFieldId,
        requestType: 'selected',
      })
      ._unsafeUnwrap();

    expect(plan.selectionType).toBe('candidate');
    expect(plan.foreignTableId().equals(fixture.foreignTableId)).toBe(true);
    expect(plan.lookupFieldId().equals(fixture.lookupFieldId)).toBe(true);
    expect(plan.linkFieldId().equals(fixture.linkFieldId)).toBe(true);
  });

  it('uses the requested candidate mode only for Plugin Views', () => {
    const plugin = buildTable('plugin');
    const grid = buildTable('grid');

    expect(
      plugin.table
        .createViewLinkRecordsQueryPlan({
          viewId: plugin.viewId,
          fieldId: plugin.linkFieldId,
          requestType: 'candidate',
        })
        ._unsafeUnwrap().selectionType
    ).toBe('candidate');
    expect(
      plugin.table
        .createViewLinkRecordsQueryPlan({
          viewId: plugin.viewId,
          fieldId: plugin.linkFieldId,
        })
        ._unsafeUnwrap().selectionType
    ).toBe('selected');
    expect(
      grid.table
        .createViewLinkRecordsQueryPlan({
          viewId: grid.viewId,
          fieldId: grid.linkFieldId,
          requestType: 'candidate',
        })
        ._unsafeUnwrap().selectionType
    ).toBe('selected');
  });

  it('rejects hidden Fields unless the share explicitly includes them', () => {
    const fixture = buildTable('grid');
    const hiddenTable = fixture.table
      .updateViewColumnMeta(fixture.viewId, [
        { fieldId: fixture.linkFieldId, columnMeta: { hidden: true } },
      ])
      ._unsafeUnwrap().updateResult!.table;

    expect(
      hiddenTable
        .createViewLinkRecordsQueryPlan({
          viewId: fixture.viewId,
          fieldId: fixture.linkFieldId,
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'view_link_records.field_hidden', tags: ['forbidden'] });
    expect(
      hiddenTable
        .createViewLinkRecordsQueryPlan({
          viewId: fixture.viewId,
          fieldId: fixture.linkFieldId,
          includeHiddenFields: true,
        })
        ._unsafeUnwrap().selectionType
    ).toBe('selected');
  });

  it('rejects a visible non-Link Field at the aggregate boundary', () => {
    const fixture = buildTable('grid');

    expect(
      fixture.table
        .createViewLinkRecordsQueryPlan({
          viewId: fixture.viewId,
          fieldId: fixture.primaryFieldId,
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'view_link_records.field_not_link', tags: ['forbidden'] });
  });
});
