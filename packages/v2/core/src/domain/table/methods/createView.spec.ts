import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { TableAddViewSpec } from '../specs/TableAddViewSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Planning')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Estimate')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTableWithViewDefaults = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Defaults')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().attachment().withName(FieldName.create('Cover')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Start')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('End')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Action')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.createView', () => {
  it('creates a fully initialized View and returns its mutation spec', () => {
    const table = buildTable();
    const [titleField] = table.getFields();
    const ignoredFieldId = `fld${'z'.repeat(16)}`;

    const result = table.createView({
      name: 'Delivery',
      type: 'grid',
      columnMeta: {
        [titleField!.id().toString()]: { width: 240 },
        [ignoredFieldId]: { width: 320 },
      },
      options: { rowHeight: 'short' },
    });

    expect(result.isOk()).toBe(true);
    const { view, updateResult } = result._unsafeUnwrap();
    expect(view.name().toString()).toBe('Delivery');
    expect(view.type().toString()).toBe('grid');
    expect(view.options()).toEqual({ rowHeight: 'short' });
    expect(view.queryDefaults()._unsafeUnwrap().toDto()).toEqual({});
    expect(view.columnMeta()._unsafeUnwrap().toDto()).toEqual({
      [titleField!.id().toString()]: { order: 0, width: 240 },
      [table.getFields()[1]!.id().toString()]: { order: 1 },
    });
    expect(updateResult.mutateSpec).toBeInstanceOf(TableAddViewSpec);
    expect(updateResult.table.views()).toHaveLength(2);
    expect(updateResult.table.getView(view.id())._unsafeUnwrap()).toBe(view);
  });

  it('owns the default and unique View naming rules', () => {
    const table = buildTable();
    const first = table.createView({ type: 'grid' })._unsafeUnwrap();
    const second = first.updateResult.table.createView({ type: 'grid' })._unsafeUnwrap();

    expect(first.view.name().toString()).toBe('New view');
    expect(second.view.name().toString()).toBe('New view 2');
  });

  it.each(['', '  Planning  '])('preserves the public View name contract for %j', (name) => {
    const result = buildTable().createView({ type: 'grid', name });

    expect(result._unsafeUnwrap().view.name().toString()).toBe(name);
  });

  it.each([
    ['grid', undefined],
    ['calendar', undefined],
    ['kanban', undefined],
    ['form', undefined],
    ['gallery', undefined],
    [
      'plugin',
      {
        pluginId: 'plg-view',
        pluginInstallId: 'pli-view',
        pluginLogo: 'https://example.test/logo.png',
      },
    ],
  ] as const)('creates the %s View subtype inside the aggregate', (type, options) => {
    const result = buildTable().createView({ type, options });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().view.type().toString()).toBe(type);
  });

  it('owns legacy creation properties and query defaults', () => {
    const table = buildTable();
    const fieldId = table.primaryFieldId().toString();
    const result = table.createView({
      type: 'grid',
      description: 'Planning details',
      filter: {
        conjunction: 'and',
        items: [{ fieldId, operator: 'is', value: 'alpha' }],
      },
      sort: [{ fieldId, order: 'desc' }],
      group: [{ fieldId, order: 'asc' }],
      manualSort: false,
      isLocked: true,
      enableShare: true,
      shareId: 'shr-planning',
      shareMeta: {
        allowCopy: false,
        includeRecords: true,
        submit: { requireLogin: true },
      },
    });

    expect(result.isOk()).toBe(true);
    const view = result._unsafeUnwrap().view;
    expect(view.properties().toDto()).toEqual({
      description: 'Planning details',
      isLocked: true,
      enableShare: true,
      shareId: 'shr-planning',
      shareMeta: {
        allowCopy: false,
        includeRecords: true,
        submit: { requireLogin: true },
      },
    });
    expect(view.queryDefaults()._unsafeUnwrap().toDto()).toEqual({
      filter: {
        conjunction: 'and',
        items: [{ fieldId, operator: 'is', value: 'alpha' }],
      },
      sort: [{ fieldId, order: 'desc' }],
      group: [{ fieldId, order: 'asc' }],
      manualSort: false,
    });
  });

  it('owns Gallery, Calendar, and Form creation defaults', () => {
    const table = buildTableWithViewDefaults();
    const [, coverField, startField, endField, buttonField] = table.getFields();

    const gallery = table.createView({ type: 'gallery' })._unsafeUnwrap().view;
    const calendar = table.createView({ type: 'calendar' })._unsafeUnwrap().view;
    const form = table.createView({ type: 'form' })._unsafeUnwrap().view;

    expect(gallery.options()).toEqual({ coverFieldId: coverField!.id().toString() });
    expect(calendar.options()).toEqual({
      startDateFieldId: startField!.id().toString(),
      endDateFieldId: endField!.id().toString(),
    });
    const formMeta = form.columnMeta()._unsafeUnwrap().toDto();
    expect(formMeta[coverField!.id().toString()]?.visible).toBe(true);
    expect(formMeta[startField!.id().toString()]?.visible).toBe(true);
    expect(formMeta[endField!.id().toString()]?.visible).toBe(true);
    expect(formMeta[buttonField!.id().toString()]?.visible).toBeUndefined();
  });

  it('keeps type-required columns visible when input tries to hide them', () => {
    const table = buildTableWithViewDefaults();
    const [primaryField, coverField, startField] = table.getFields();
    const gallery = table
      .createView({
        type: 'gallery',
        columnMeta: { [primaryField!.id().toString()]: { visible: false } },
      })
      ._unsafeUnwrap().view;
    const form = table
      .createView({
        type: 'form',
        columnMeta: {
          [coverField!.id().toString()]: { visible: false },
          [startField!.id().toString()]: { visible: false },
        },
      })
      ._unsafeUnwrap().view;

    expect(
      gallery.columnMeta()._unsafeUnwrap().toDto()[primaryField!.id().toString()]?.visible
    ).toBe(true);
    expect(form.columnMeta()._unsafeUnwrap().toDto()[coverField!.id().toString()]?.visible).toBe(
      true
    );
    expect(form.columnMeta()._unsafeUnwrap().toDto()[startField!.id().toString()]?.visible).toBe(
      true
    );
  });

  it('preserves an empty filter group as a valid View default', () => {
    const result = buildTable().createView({
      type: 'grid',
      filter: { conjunction: 'and', items: [] },
    });

    expect(result._unsafeUnwrap().view.queryDefaults()._unsafeUnwrap().filter()).toEqual({
      conjunction: 'and',
      items: [],
    });
  });

  it('keeps the source filter for lossless compatibility persistence', () => {
    const sourceFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldLegacy', operator: 'IN', isSymbol: true, value: 'alpha' }],
    };
    const result = buildTable().createView({
      type: 'grid',
      filter: {
        fieldId: 'fldLegacy',
        operator: 'isAnyOf',
        value: ['alpha'],
      },
      sourceFilter,
    });
    const defaults = result._unsafeUnwrap().view.queryDefaults()._unsafeUnwrap();

    expect(defaults.filter()).toEqual({
      conjunction: 'and',
      items: [
        {
          fieldId: 'fldLegacy',
          operator: 'isAnyOf',
          value: ['alpha'],
        },
      ],
    });
    expect(defaults.sourceFilter()).toEqual(sourceFilter);
  });

  it('covers absent and explicitly configured type-default branches', () => {
    const tableWithoutDefaults = buildTable();
    expect(
      tableWithoutDefaults.createView({ type: 'gallery' })._unsafeUnwrap().view.options()
    ).toEqual({});
    expect(
      tableWithoutDefaults.createView({ type: 'calendar' })._unsafeUnwrap().view.options()
    ).toBeUndefined();

    const tableWithDefaults = buildTableWithViewDefaults();
    const [, coverField, startField] = tableWithDefaults.getFields();
    const gallery = tableWithDefaults
      .createView({
        type: 'gallery',
        options: { coverFieldId: startField!.id().toString(), isCoverFit: true },
      })
      ._unsafeUnwrap().view;
    const calendar = tableWithDefaults
      .createView({
        type: 'calendar',
        options: {
          startDateFieldId: startField!.id().toString(),
          endDateFieldId: startField!.id().toString(),
        },
      })
      ._unsafeUnwrap().view;

    expect(gallery.options()).toEqual({
      coverFieldId: startField!.id().toString(),
      isCoverFit: true,
    });
    expect(gallery.options()).not.toMatchObject({ coverFieldId: coverField!.id().toString() });
    expect(calendar.options()).toEqual({
      startDateFieldId: startField!.id().toString(),
      endDateFieldId: startField!.id().toString(),
    });
  });

  it.each([
    ['grid', { rowHeight: 'unsupported' }],
    ['gallery', { unexpected: true }],
    ['calendar', { colorConfig: { type: 'custom', color: 'not-a-color' } }],
    ['form', { coverUrl: 42 }],
    ['kanban', { isCoverFit: 'yes' }],
    ['plugin', { pluginId: 'plg', pluginInstallId: 'pli' }],
  ] as const)('rejects invalid %s creation options inside the aggregate', (type, options) => {
    expect(buildTable().createView({ type, options }).isErr()).toBe(true);
  });
});
