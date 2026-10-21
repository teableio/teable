import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const id = (prefix: 'bse' | 'tbl' | 'fld' | 'viw', seed: string) => `${prefix}${seed.repeat(16)}`;

const buildTable = (viewType: 'grid' | 'form' | 'kanban' | 'plugin') => {
  const primaryFieldId = FieldId.create(id('fld', 'p'))._unsafeUnwrap();
  const userFieldId = FieldId.create(id('fld', 'u'))._unsafeUnwrap();
  const viewId = ViewId.create(id('viw', 'v'))._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(id('bse', 'b'))._unsafeUnwrap())
    .withId(TableId.create(id('tbl', 't'))._unsafeUnwrap())
    .withName(TableName.create('Collaborators')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .user()
    .withId(userFieldId)
    .withName(FieldName.create('Owner')._unsafeUnwrap())
    .done();
  builder.view()[viewType]().withId(viewId).defaultName().done();
  const table = builder.build()._unsafeUnwrap();
  return { table, viewId, userFieldId, primaryFieldId };
};

describe('Table.createViewCollaboratorsQueryPlan', () => {
  it.each(['form', 'kanban', 'plugin'] as const)(
    'uses the full member directory for a %s View with a visible user-related Field',
    (viewType) => {
      const fixture = buildTable(viewType);

      expect(
        fixture.table.createViewCollaboratorsQueryPlan({ viewId: fixture.viewId })._unsafeUnwrap()
          .mode
      ).toBe('all');
    }
  );

  it('uses referenced users for ordinary Grid shares and preserves the View filter', () => {
    const fixture = buildTable('grid');
    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: fixture.primaryFieldId.toString(),
          operator: 'is' as const,
          value: 'Visible',
        },
      ],
    };
    const table = fixture.table.updateViewFilter(fixture.viewId, filter)._unsafeUnwrap()
      .updateResult!.table;
    const plan = table
      .createViewCollaboratorsQueryPlan({
        viewId: fixture.viewId,
        fieldId: fixture.userFieldId,
      })
      ._unsafeUnwrap();

    expect(plan.mode).toBe('referenced');
    expect(plan.referencedField()._unsafeUnwrap().id().equals(fixture.userFieldId)).toBe(true);
    expect(plan.recordFilter()).toEqual({
      conjunction: 'and',
      items: filter.filterSet,
    });
  });

  it('allows a share editor to use the full directory for an ordinary Grid View', () => {
    const fixture = buildTable('grid');

    expect(
      fixture.table
        .createViewCollaboratorsQueryPlan({
          viewId: fixture.viewId,
          canReadAllCollaborators: true,
        })
        ._unsafeUnwrap().mode
    ).toBe('all');
  });

  it('returns an empty all-mode plan when the requested or visible Field is not user-related', () => {
    const fixture = buildTable('form');
    const hidden = fixture.table
      .updateViewColumnMeta(fixture.viewId, [
        { fieldId: fixture.userFieldId, columnMeta: { visible: false } },
      ])
      ._unsafeUnwrap().updateResult!.table;

    expect(
      fixture.table
        .createViewCollaboratorsQueryPlan({
          viewId: fixture.viewId,
          fieldId: fixture.primaryFieldId,
        })
        ._unsafeUnwrap().mode
    ).toBe('empty');
    expect(
      hidden.createViewCollaboratorsQueryPlan({ viewId: fixture.viewId })._unsafeUnwrap().mode
    ).toBe('empty');
    expect(
      hidden
        .createViewCollaboratorsQueryPlan({
          viewId: fixture.viewId,
          includeHiddenFields: true,
        })
        ._unsafeUnwrap().mode
    ).toBe('all');
  });

  it('rejects missing, hidden, and non-user Fields for referenced Grid queries', () => {
    const fixture = buildTable('grid');
    const hidden = fixture.table
      .updateViewColumnMeta(fixture.viewId, [
        { fieldId: fixture.userFieldId, columnMeta: { hidden: true } },
      ])
      ._unsafeUnwrap().updateResult!.table;

    expect(
      fixture.table.createViewCollaboratorsQueryPlan({ viewId: fixture.viewId })._unsafeUnwrapErr()
    ).toMatchObject({ code: 'view_collaborators.field_required', tags: ['validation'] });
    expect(
      hidden
        .createViewCollaboratorsQueryPlan({
          viewId: fixture.viewId,
          fieldId: fixture.userFieldId,
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'view_collaborators.field_hidden', tags: ['forbidden'] });
    expect(
      fixture.table
        .createViewCollaboratorsQueryPlan({
          viewId: fixture.viewId,
          fieldId: fixture.primaryFieldId,
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({
      code: 'view_collaborators.field_not_user_related',
      tags: ['forbidden'],
    });
  });

  it('uses the full directory without a View when the Table has a user-related Field', () => {
    const fixture = buildTable('grid');
    expect(fixture.table.createViewCollaboratorsQueryPlan({})._unsafeUnwrap().mode).toBe('all');
  });
});
