import { describe, expect, it } from 'vitest';

import {
  baseVcsPatchSchema,
  collectPromotionLinkTargets,
  describePromotionPatch,
  diffSnapshots,
  selectPromotionPatch,
  type IBaseVcsSnapshot,
  type IFieldVcsSnapshot,
  type ITableVcsSnapshot,
} from '../index';

const title = {
  id: 'fldTitle',
  name: 'Title',
  type: 'singleLineText',
  isPrimary: true,
  isComputed: false,
};
const formula = {
  id: 'fldTotal',
  name: 'Total',
  type: 'formula',
  isPrimary: false,
  isComputed: true,
  options: { expression: '1 + 1', timeZone: 'utc' },
};
const openChoice = { id: 'choOpen', name: 'Open', color: 'blueBright' };
const status = {
  id: 'fldStatus',
  name: 'Status',
  type: 'singleSelect',
  isPrimary: false,
  isComputed: false,
  options: { choices: [openChoice] },
};
const view = { id: 'viwOrders', name: 'Grid', type: 'grid', query: { manualSort: false } };
const orderTable: ITableVcsSnapshot = {
  id: 'tblOrders',
  name: 'Orders',
  primaryFieldId: title.id,
  fields: [title, status, formula],
  views: [view],
  records: [
    { id: 'recBusiness', fields: { [title.id]: 'Business record' }, orders: { [view.id]: 1 } },
    { id: 'recConfig', fields: { [title.id]: 'Old config' }, orders: { [view.id]: 2 } },
    { id: 'recRemoved', fields: { [title.id]: 'Keep in production' }, autoNumber: 3, version: 4 },
  ],
};

const snapshot = (tables: readonly ITableVcsSnapshot[]): IBaseVcsSnapshot => ({
  formatVersion: 1,
  baseId: 'bsePromotion',
  baseName: 'Orders',
  revision: 3,
  capturedAt: '2026-11-24T00:00:00.000Z',
  tables,
});

function fieldChange(before: IFieldVcsSnapshot, after: IFieldVcsSnapshot) {
  return diffSnapshots(
    snapshot([{ ...orderTable, fields: [title, before] }]),
    snapshot([{ ...orderTable, fields: [title, after] }])
  );
}

describe('selectPromotionPatch', () => {
  it('keeps schema, one selected config edit and one selected seed row without any dummy data', () => {
    const nextFormula = { ...formula, options: { ...formula.options, expression: '4 * 9' } };
    const choices = [
      { id: 'choPaid', name: 'Paid', color: 'greenBright' },
      { ...openChoice, color: 'orangeBright' },
    ];
    const nextStatus = { ...status, options: { choices } };
    const extraView = { id: 'viwSummary', name: 'Summary', type: 'grid' };
    const renamedView = { ...view, name: 'Fulfillment', query: { manualSort: true } };
    const configValue = 'Complete configuration\n'.repeat(200);
    const dummyRows = Array.from({ length: 20 }, (_, index) => ({
      id: `recDummy${index}`,
      fields: { [title.id]: `Dummy value ${index}`, [formula.id]: 36 },
      orders: { [view.id]: index + 10 },
      autoNumber: index + 10,
    }));
    const newTable: ITableVcsSnapshot = {
      ...orderTable,
      id: 'tblSeed',
      name: 'Seed configuration',
      records: [
        ...dummyRows.slice(10),
        { id: 'recSeed', fields: { [title.id]: 'Launch config', [formula.id]: 2 }, autoNumber: 1 },
      ],
    };
    const rawPatch = diffSnapshots(
      snapshot([orderTable]),
      snapshot([
        {
          ...orderTable,
          name: 'Fulfillment Orders',
          fields: [title, nextStatus, nextFormula],
          views: [renamedView, extraView],
          records: [
            { id: 'recBusiness', fields: { [title.id]: 'Sandbox edit' }, orders: { [view.id]: 5 } },
            { id: 'recConfig', fields: { [title.id]: configValue }, orders: { [view.id]: 7 } },
            ...dummyRows.slice(0, 10),
          ],
        },
        newTable,
      ])
    );
    const originalPatch = structuredClone(rawPatch);
    const projected = selectPromotionPatch(
      rawPatch,
      [
        { tableId: orderTable.id, recordId: 'recConfig' },
        { tableId: newTable.id, recordId: 'recSeed' },
      ],
      snapshot([orderTable])
    );
    expect(rawPatch).toEqual(originalPatch);
    expect(projected.tablesAdded).toEqual([
      expect.objectContaining({
        id: newTable.id,
        records: [{ id: 'recSeed', fields: { [title.id]: 'Launch config' }, autoNumber: 1 }],
      }),
    ]);
    const rawTable = rawPatch.tablesUpdated[0];
    expect(projected.tablesUpdated).toEqual([
      {
        ...rawTable,
        recordsAdded: [],
        recordsDeleted: [],
        recordsUpdated: [
          {
            recordId: 'recConfig',
            cellChanges: [{ fieldId: title.id, before: 'Old config', after: configValue }],
            orderChanges: [{ viewId: view.id, before: 2, after: 7 }],
          },
        ],
      },
    ]);

    const persisted = baseVcsPatchSchema.parse(JSON.parse(JSON.stringify(projected)));
    const review = describePromotionPatch(persisted);
    expect(review).toHaveLength(14);
    expect(review).toEqual(
      expect.arrayContaining([
        {
          table: 'Fulfillment Orders',
          path: 'Field Total (fldTotal) / options / expression',
          before: JSON.stringify(formula.options.expression),
          after: JSON.stringify(nextFormula.options.expression),
        },
        expect.objectContaining({
          path: 'Field Status (fldStatus) / options / choices',
          after: expect.stringContaining('Paid'),
        }),
        expect.objectContaining({
          path: 'View Fulfillment (viwOrders) / name',
          after: '"Fulfillment"',
        }),
        expect.objectContaining({
          path: 'View Fulfillment (viwOrders) / query / manualSort',
          after: 'true',
        }),
        expect.objectContaining({ path: 'View Summary (viwSummary)' }),
        expect.objectContaining({
          path: 'Record recConfig / Field fldTitle',
          after: JSON.stringify(configValue),
        }),
        expect.objectContaining({
          path: 'Record recConfig / Order in view viwOrders',
          before: '2',
          after: '7',
        }),
        expect.objectContaining({ table: newTable.name, path: 'Record recSeed' }),
      ])
    );
    expect(JSON.stringify(review)).not.toMatch(/recDummy|Dummy value|recBusiness|recRemoved/);
  });

  it('drops record-only subpatches and all rows in an unselected new table', () => {
    const newTable = { ...orderTable, id: 'tblNew' };
    const working = { ...orderTable, records: [] };
    const projected = selectPromotionPatch(
      diffSnapshots(snapshot([orderTable]), snapshot([working, newTable])),
      [],
      snapshot([orderTable])
    );
    expect(projected).toEqual({
      tablesAdded: [{ ...newTable, records: [] }],
      tablesUpdated: [],
      tablesDeleted: [],
    });
  });

  it('rejects duplicate keys and keys that do not identify a changed row in that table', () => {
    const raw = diffSnapshots(snapshot([]), snapshot([orderTable]));
    const key = { tableId: orderTable.id, recordId: 'recConfig' };
    expect(() => selectPromotionPatch(raw, [key, key], snapshot([]))).toThrow(
      expect.objectContaining({ code: 'vcs.invalid_promotion_selection', details: key })
    );
    for (const invalid of [
      { ...key, tableId: 'tblOther' },
      { ...key, recordId: 'recMissing' },
    ]) {
      expect(() => selectPromotionPatch(raw, [invalid], snapshot([]))).toThrow(
        expect.objectContaining({ code: 'vcs.invalid_promotion_selection', details: invalid })
      );
    }
  });

  it('rejects a selected deletion that could clear links in unselected records', () => {
    const working = { ...orderTable, records: [] };
    const raw = diffSnapshots(snapshot([orderTable]), snapshot([working]));
    expect(() =>
      selectPromotionPatch(
        raw,
        [{ tableId: orderTable.id, recordId: 'recBusiness' }],
        snapshot([orderTable])
      )
    ).toThrow(
      expect.objectContaining({
        code: 'vcs.unsupported_promotion_patch',
        details: { tableId: orderTable.id, recordId: 'recBusiness' },
      })
    );
  });

  it('rejects selected links to excluded sandbox rows and allows both ends when selected', () => {
    const link = {
      id: 'fldRelated',
      name: 'Related',
      type: 'link',
      isPrimary: false,
      isComputed: false,
      options: { isOneWay: true, foreignTableId: 'tblRelated' },
    };
    const related = { id: 'recRelated', fields: { [title.id]: 'Sandbox related record' } };
    const linked = {
      id: 'recConfig',
      fields: { [title.id]: 'Config', [link.id]: [{ id: related.id, title: 'Related' }] },
    };
    const table = { ...orderTable, fields: [...orderTable.fields, link], records: [linked] };
    const target = { ...orderTable, id: 'tblRelated', records: [related] };
    const patch = diffSnapshots(snapshot([orderTable]), snapshot([table, target]));
    const selected = { tableId: table.id, recordId: linked.id };
    expect(() => selectPromotionPatch(patch, [selected], snapshot([orderTable]))).toThrow(
      expect.objectContaining({
        code: 'vcs.unsupported_promotion_patch',
        details: {
          ...selected,
          fieldId: link.id,
          targetTableId: target.id,
          targetRecordId: related.id,
        },
      })
    );
    const projected = selectPromotionPatch(
      patch,
      [selected, { tableId: target.id, recordId: related.id }],
      snapshot([orderTable])
    );
    expect(projected.tablesAdded[0].records).toEqual([related]);
    expect(projected.tablesUpdated[0].recordsUpdated[0].cellChanges).toContainEqual({
      fieldId: link.id,
      before: null,
      after: linked.fields[link.id],
    });
  });

  it('verifies one-way target existence against the checkpoint after transport omits other rows', () => {
    const target = { ...orderTable, id: 'tblTargets', records: [] };
    const link = {
      id: 'fldTarget',
      name: 'Related',
      type: 'link',
      isPrimary: false,
      isComputed: false,
      options: { foreignTableId: target.id, isOneWay: true },
    };
    const source = { ...orderTable, fields: [...orderTable.fields, link] };
    const targetRecord = { id: 'recTarget', fields: { [title.id]: 'Target' } };
    const checkpoint = snapshot([source, target]);
    const sourceWithLink = {
      ...source,
      records: source.records.map((record) =>
        record.id === 'recConfig'
          ? { ...record, fields: { ...record.fields, [link.id]: [{ id: targetRecord.id }] } }
          : record
      ),
    };
    const scoped = diffSnapshots(checkpoint, snapshot([sourceWithLink, target]));
    const selected = [{ tableId: source.id, recordId: 'recConfig' }];
    expect(collectPromotionLinkTargets(scoped, checkpoint)).toEqual(
      new Map([[target.id, new Set([targetRecord.id])]])
    );
    expect(() => selectPromotionPatch(scoped, selected, checkpoint)).toThrow(
      expect.objectContaining({
        code: 'vcs.unsupported_promotion_patch',
        details: {
          ...selected[0],
          fieldId: link.id,
          targetTableId: target.id,
          targetRecordId: targetRecord.id,
        },
      })
    );

    const trusted = snapshot([source, { ...target, records: [targetRecord] }]);
    expect(selectPromotionPatch(scoped, selected, trusted)).toEqual(scoped);
  });

  it('requires matching changes to pre-existing reciprocal link cells', () => {
    const link = {
      id: 'fldCustomer',
      name: 'Customer',
      type: 'link',
      isPrimary: false,
      isComputed: false,
      options: { foreignTableId: 'tblCustomers', symmetricFieldId: 'fldOrders', isOneWay: false },
    };
    const inverse = {
      ...link,
      id: 'fldOrders',
      name: 'Orders',
      options: { foreignTableId: orderTable.id, symmetricFieldId: link.id, isOneWay: false },
    };
    const order = { id: 'recOrder', fields: { [title.id]: 'Sample order' } };
    const customer = { id: 'recCustomer', fields: { [title.id]: 'Sample customer' } };
    const tables: ITableVcsSnapshot[] = [
      { ...orderTable, fields: [title, link], records: [order] },
      {
        ...orderTable,
        id: 'tblCustomers',
        name: 'Customers',
        fields: [title, inverse],
        records: [customer],
      },
    ];
    const checkpoint = snapshot(tables);
    const linkedOrder = { ...order, fields: { ...order.fields, [link.id]: { id: customer.id } } };
    const linkedCustomer = {
      ...customer,
      fields: { ...customer.fields, [inverse.id]: [{ id: order.id }] },
    };
    const linked = snapshot([
      { ...tables[0], records: [linkedOrder] },
      { ...tables[1], records: [linkedCustomer] },
    ]);
    const selection = [
      { tableId: tables[0].id, recordId: order.id },
      { tableId: tables[1].id, recordId: customer.id },
    ];
    const patch = diffSnapshots(checkpoint, linked);
    const scoped = {
      ...patch,
      tablesUpdated: patch.tablesUpdated.filter(({ tableId }) => tableId === tables[0].id),
    };
    expect(() => selectPromotionPatch(scoped, [selection[0]], checkpoint)).toThrow(
      expect.objectContaining({
        code: 'vcs.unsupported_promotion_patch',
        details: expect.objectContaining({ targetFieldId: inverse.id }),
      })
    );
    expect(() => selectPromotionPatch(patch, [selection[0]], checkpoint)).toThrow(
      expect.objectContaining({
        code: 'vcs.unsupported_promotion_patch',
        details: {
          ...selection[0],
          fieldId: link.id,
          targetTableId: tables[1].id,
          targetRecordId: customer.id,
          targetFieldId: inverse.id,
        },
      })
    );
    expect(selectPromotionPatch(patch, selection, checkpoint)).toEqual(patch);

    const unlink = diffSnapshots(linked, checkpoint);
    expect(() => selectPromotionPatch(unlink, [selection[0]], linked)).toThrow(
      expect.objectContaining({ code: 'vcs.unsupported_promotion_patch' })
    );
    expect(selectPromotionPatch(unlink, selection, linked)).toEqual(unlink);
  });

  it('rejects destructive schema changes instead of silently dropping them', () => {
    const cases = [
      diffSnapshots(snapshot([orderTable]), snapshot([])),
      diffSnapshots(snapshot([orderTable]), snapshot([{ ...orderTable, fields: [title] }])),
      diffSnapshots(snapshot([orderTable]), snapshot([{ ...orderTable, views: [] }])),
      fieldChange(status, { ...status, type: 'singleLineText' }),
      fieldChange(status, { ...status, options: { choices: [] } }),
      fieldChange(status, {
        ...status,
        options: { choices: [{ ...openChoice, name: 'Renamed' }] },
      }),
    ];
    for (const patch of cases) {
      expect(() => selectPromotionPatch(patch, [], snapshot([orderTable]))).toThrow(
        expect.objectContaining({ code: 'vcs.unsupported_promotion_patch' })
      );
    }
  });
});
