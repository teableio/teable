import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const id = (prefix: 'bse' | 'tbl' | 'fld' | 'viw', seed: string) => `${prefix}${seed.repeat(16)}`;
const hash = (value: string) => {
  let result = 5381;
  let index = value.length;
  while (index) result = (result * 33) ^ value.charCodeAt(--index);
  return result >>> 0;
};

const buildTable = (shareMeta: {
  allowCopy?: boolean;
  includeRecords?: boolean;
  includeHiddenField?: boolean;
}) => {
  const primaryFieldId = FieldId.create(id('fld', 'p'))._unsafeUnwrap();
  const hiddenFieldId = FieldId.create(id('fld', 'h'))._unsafeUnwrap();
  const amountFieldId = FieldId.create(id('fld', 'a'))._unsafeUnwrap();
  const viewId = ViewId.create(id('viw', 'v'))._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(id('bse', 'b'))._unsafeUnwrap())
    .withId(TableId.create(id('tbl', 't'))._unsafeUnwrap())
    .withName(TableName.create('Copy')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withId(hiddenFieldId)
    .withName(FieldName.create('Secret')._unsafeUnwrap())
    .done();
  builder
    .field()
    .number()
    .withId(amountFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().grid().withId(viewId).defaultName().done();
  const table = builder
    .build()
    ._unsafeUnwrap()
    .updateViewColumnMeta(viewId, [
      { fieldId: primaryFieldId, columnMeta: { order: 0 } },
      { fieldId: hiddenFieldId, columnMeta: { order: 1, hidden: true } },
      { fieldId: amountFieldId, columnMeta: { order: 2 } },
    ])
    ._unsafeUnwrap().updateResult!.table;
  const withMeta = table.updateViewShareMeta(viewId, shareMeta)._unsafeUnwrap().updateResult!.table;
  const enabled = withMeta.enableViewShare(viewId)._unsafeUnwrap().updateResult.table;
  return { table: enabled, viewId, primaryFieldId, hiddenFieldId, amountFieldId };
};

describe('Table.createViewSelectionCopyPlan', () => {
  it('bounds projection to visible fields while preserving requested order', () => {
    const fixture = buildTable({ allowCopy: true, includeRecords: true });
    const plan = fixture.table
      .createViewSelectionCopyPlan({
        viewId: fixture.viewId,
        ranges: [
          [0, 0],
          [1, 0],
        ],
        projection: [fixture.hiddenFieldId, fixture.amountFieldId, fixture.primaryFieldId],
      })
      ._unsafeUnwrap();

    expect(plan.fields.map((field) => field.id().toString())).toEqual([
      fixture.amountFieldId.toString(),
      fixture.primaryFieldId.toString(),
    ]);
    expect(plan.recordWindows).toEqual([{ offset: 0, limit: 1 }]);
  });

  it('includes hidden fields only when the share metadata explicitly allows them', () => {
    const fixture = buildTable({
      allowCopy: true,
      includeRecords: true,
      includeHiddenField: true,
    });
    const plan = fixture.table
      .createViewSelectionCopyPlan({
        viewId: fixture.viewId,
        ranges: [
          [0, 0],
          [2, 0],
        ],
      })
      ._unsafeUnwrap();

    expect(plan.fields.map((field) => field.id().toString())).toEqual([
      fixture.primaryFieldId.toString(),
      fixture.hiddenFieldId.toString(),
      fixture.amountFieldId.toString(),
    ]);
  });

  it('rejects caller query fields outside the shared View boundary', () => {
    const fixture = buildTable({ allowCopy: true, includeRecords: true });

    expect(
      fixture.table
        .createViewSelectionCopyPlan({
          viewId: fixture.viewId,
          ranges: [
            [0, 0],
            [0, 0],
          ],
          queryFieldIds: [fixture.hiddenFieldId.toString()],
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({
      code: 'view_selection_copy.query_field_hidden',
      tags: ['forbidden'],
    });
  });

  it('enforces share lifecycle and copy permission while allowing a trusted editor override', () => {
    const fixture = buildTable({ allowCopy: false, includeRecords: true });
    expect(
      fixture.table
        .createViewSelectionCopyPlan({
          viewId: fixture.viewId,
          ranges: [
            [0, 0],
            [0, 0],
          ],
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'view_selection_copy.not_allowed', tags: ['forbidden'] });
    expect(
      fixture.table
        .createViewSelectionCopyPlan({
          viewId: fixture.viewId,
          canCopyAsEditor: true,
          ranges: [
            [0, 0],
            [0, 0],
          ],
        })
        ._unsafeUnwrap().fields
    ).toHaveLength(1);

    const disabled = fixture.table.disableViewShare(fixture.viewId)._unsafeUnwrap()
      .updateResult.table;
    expect(
      disabled
        .createViewSelectionCopyPlan({
          viewId: fixture.viewId,
          canCopyAsEditor: true,
          ranges: [
            [0, 0],
            [0, 0],
          ],
        })
        ._unsafeUnwrapErr().code
    ).toBe('view_selection_copy.share_disabled');
  });

  it('returns a no-record plan when the shared view excludes records', () => {
    const fixture = buildTable({ allowCopy: true, includeRecords: false });
    const plan = fixture.table
      .createViewSelectionCopyPlan({
        viewId: fixture.viewId,
        ranges: [
          [0, 0],
          [0, 1],
        ],
      })
      ._unsafeUnwrap();

    expect(plan.recordsIncluded).toBe(false);
    expect(plan.fields).toHaveLength(1);
  });

  it('preserves disjoint row and column ranges in request order', () => {
    const fixture = buildTable({ allowCopy: true, includeRecords: true });
    const rows = fixture.table
      .createViewSelectionCopyPlan({
        viewId: fixture.viewId,
        type: 'rows',
        ranges: [
          [3, 4],
          [1, 1],
        ],
      })
      ._unsafeUnwrap();
    expect(rows.recordWindows).toEqual([
      { offset: 3, limit: 2 },
      { offset: 1, limit: 1 },
    ]);
    expect(rows.requestedCellCount()._unsafeUnwrap()).toBe(6);

    const columns = fixture.table
      .createViewSelectionCopyPlan({
        viewId: fixture.viewId,
        type: 'columns',
        ranges: [
          [1, 1],
          [0, 0],
        ],
      })
      ._unsafeUnwrap();
    expect(columns.fields.map((field) => field.id().toString())).toEqual([
      fixture.amountFieldId.toString(),
      fixture.primaryFieldId.toString(),
    ]);
    expect(columns.requestedCellCount(4)._unsafeUnwrap()).toBe(8);
  });

  it.each([
    { ranges: [[0, 0]] },
    {
      ranges: [
        [1, 0],
        [0, 0],
      ],
    },
    { type: 'rows' as const, ranges: [[2, 1]] },
  ])('rejects malformed or reversed ranges: $ranges', (input) => {
    const fixture = buildTable({ allowCopy: true, includeRecords: true });
    expect(
      fixture.table
        .createViewSelectionCopyPlan({
          viewId: fixture.viewId,
          ...input,
          ranges: input.ranges as Array<[number, number]>,
        })
        ._unsafeUnwrapErr().code
    ).toBe('view_selection_copy.invalid_ranges');
  });

  it('builds collapsed-group exclusions from aggregate-owned Field semantics', () => {
    const fixture = buildTable({ allowCopy: true, includeRecords: true });
    const groupId = String(hash(`${fixture.primaryFieldId.toString()}_Alpha`));

    expect(
      fixture.table
        .createCollapsedGroupExclusionFilter(
          [{ fieldId: fixture.primaryFieldId.toString(), order: 'asc' }],
          [{ groupValues: ['Alpha'] }, { groupValues: ['Beta'] }],
          new Set([groupId])
        )
        ._unsafeUnwrap()
    ).toEqual({
      conjunction: 'and',
      items: [
        {
          conjunction: 'or',
          items: [
            {
              fieldId: fixture.primaryFieldId.toString(),
              operator: 'isNot',
              value: 'Alpha',
            },
          ],
        },
      ],
    });
  });
});
