import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { TableAddViewSpec } from '../specs/TableAddViewSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Planning')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().attachment().withName(FieldName.create('Cover')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Start')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.duplicateView', () => {
  it('duplicates the complete View state with new identity, unique name, and share id', () => {
    const table = buildTable();
    const [titleField] = table.getFields();
    const sourceResult = table
      .createView({
        type: 'grid',
        name: 'Delivery 2',
        description: 'Delivery details',
        columnMeta: {
          [titleField!.id().toString()]: { width: 280, hidden: true },
        },
        options: { rowHeight: 'extraTall', frozenColumnCount: 1 },
        filter: {
          conjunction: 'and',
          items: [{ fieldId: titleField!.id().toString(), operator: 'is', value: 'alpha' }],
        },
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: titleField!.id().toString(),
              operator: '=',
              isSymbol: true,
              value: 'alpha',
            },
          ],
        },
        sort: [{ fieldId: titleField!.id().toString(), order: 'desc' }],
        group: [{ fieldId: titleField!.id().toString(), order: 'asc' }],
        manualSort: false,
        isLocked: true,
        enableShare: true,
        shareId: `shr${'s'.repeat(16)}`,
        shareMeta: { allowCopy: false, submit: { requireLogin: true } },
      })
      ._unsafeUnwrap();

    const duplicated = sourceResult.updateResult.table
      .duplicateView(sourceResult.view.id())
      ._unsafeUnwrap();

    expect(duplicated.view.id().equals(sourceResult.view.id())).toBe(false);
    expect(duplicated.view.name().toString()).toBe('Delivery 3');
    expect(duplicated.view.type().toString()).toBe('grid');
    expect(duplicated.view.description()).toBe('Delivery details');
    expect(duplicated.view.isLocked()).toBe(true);
    expect(duplicated.view.enableShare()).toBe(true);
    expect(duplicated.view.shareMeta()).toEqual({
      allowCopy: false,
      submit: { requireLogin: true },
    });
    expect(duplicated.view.shareId()).toMatch(/^shr[0-9a-zA-Z]{16}$/);
    expect(duplicated.view.shareId()).not.toBe(sourceResult.view.shareId());
    expect(duplicated.view.columnMeta()._unsafeUnwrap().toDto()).toEqual(
      sourceResult.view.columnMeta()._unsafeUnwrap().toDto()
    );
    expect(duplicated.view.queryDefaults()._unsafeUnwrap().toDto()).toEqual(
      sourceResult.view.queryDefaults()._unsafeUnwrap().toDto()
    );
    expect(duplicated.view.queryDefaults()._unsafeUnwrap().sourceFilter()).toEqual(
      sourceResult.view.queryDefaults()._unsafeUnwrap().sourceFilter()
    );
    expect(duplicated.view.options()).toEqual(sourceResult.view.options());
    expect(duplicated.updateResult.mutateSpec).toBeInstanceOf(TableAddViewSpec);
  });

  it.each(['grid', 'calendar', 'kanban', 'form', 'gallery'] as const)(
    'preserves the validated %s subtype options',
    (type) => {
      const table = buildTable();
      const optionsByType = {
        grid: { rowHeight: 'short' as const },
        calendar: { startDateFieldId: null, endDateFieldId: null },
        kanban: { coverFieldId: null, isCoverFit: true },
        form: { coverUrl: '', submitLabel: '' },
        gallery: { coverFieldId: null, isFieldNameHidden: true },
      };
      const source = table
        .createView({ type, name: type, options: optionsByType[type] })
        ._unsafeUnwrap();

      const duplicated = source.updateResult.table
        .duplicateView(source.view.id())
        ._unsafeUnwrap().view;

      expect(duplicated.type().toString()).toBe(type);
      expect(duplicated.options()).toEqual(source.view.options());
    }
  );

  it('requires prepared Plugin integration data and replaces the installation options', () => {
    const table = buildTable();
    const source = table
      .createView({
        type: 'plugin',
        name: 'Plugin',
        options: {
          pluginId: 'plg-source',
          pluginInstallId: 'pli-source',
          pluginLogo: 'source-logo',
        },
      })
      ._unsafeUnwrap();

    expect(source.updateResult.table.duplicateView(source.view.id()).isErr()).toBe(true);

    const duplicated = source.updateResult.table
      .duplicateView(source.view.id(), {
        pluginOptions: {
          pluginId: 'plg-source',
          pluginInstallId: 'pli-duplicate',
          pluginLogo: 'fresh-logo',
        },
      })
      ._unsafeUnwrap().view;

    expect(duplicated.options()).toEqual({
      pluginId: 'plg-source',
      pluginInstallId: 'pli-duplicate',
      pluginLogo: 'fresh-logo',
    });
  });

  it('rejects cross-aggregate and invalid Plugin override branches', () => {
    const table = buildTable();
    const missing = ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap();
    expect(table.duplicateView(missing).isErr()).toBe(true);
    expect(
      table.duplicateView(table.views()[0]!.id(), {
        pluginOptions: {
          pluginId: 'plg-source',
          pluginInstallId: 'pli-duplicate',
          pluginLogo: 'logo',
        },
      })
    ).toSatisfy((result) => result.isErr() && result.error.code === 'validation.invalid');
  });
});
