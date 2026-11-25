import {
  ActorId,
  BaseId,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  ok,
  type IQueryBus,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { historicalEngineSnapshot } from '../application/client/historicalEngineSnapshot';
import {
  projectBaseOnlySnapshot,
  projectHistoricalSnapshot,
  readHistoryVisibility,
} from '../application/server/historyProjection';
import { diffSnapshots } from '../domain/diffSnapshots';
import type { IBaseVcsSnapshot } from '../domain/types';

const snapshot: IBaseVcsSnapshot = {
  baseId: 'base',
  baseName: 'Tasks',
  revision: 1,
  capturedAt: '2026-01-01T00:00:00Z',
  formatVersion: 1,
  tables: [
    {
      id: 'tasks',
      name: 'Tasks',
      primaryFieldId: 'title',
      fields: [
        { id: 'title', name: 'Title', type: 'singleLineText', isPrimary: true, isComputed: false },
        {
          id: 'rating',
          name: 'Rating',
          type: 'rating',
          isPrimary: false,
          isComputed: false,
          options: { max: 8 },
        },
        {
          id: 'remote',
          name: 'External',
          type: 'link',
          isPrimary: false,
          isComputed: false,
          options: { baseId: 'withheld base', foreignTableId: 'external' },
        },
      ],
      views: [
        {
          id: 'grid',
          type: 'grid',
          name: 'Grid',
          description: 'Review queue',
          order: 7,
          options: { fieldNameDisplayLines: 2, frozenFieldId: 'remote' },
          columnMeta: { title: { width: 200 } },
          query: {
            sort: [{ fieldId: 'title', order: 'asc' }],
            filter: { fieldId: 'remote', value: 'withheld value' },
          },
        },
      ],
      records: [
        { id: 'row', fields: { title: 'Read me', rating: 8, remote: { id: 'withheld target' } } },
      ],
    },
  ],
};

describe('historical metadata projection', () => {
  it('keeps independent owner view properties when a predicate uses a foreign link', () => {
    const result = projectBaseOnlySnapshot(snapshot);
    const view = snapshot.tables[0].views[0];
    expect(result.tables[0].views).toEqual([
      {
        ...view,
        options: { fieldNameDisplayLines: 2 },
        query: { sort: view.query?.sort },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('withheld');
  });

  it('retains the rating range but omits masked cells and view predicates', () => {
    const result = projectHistoricalSnapshot(
      snapshot,
      new Map([
        [
          'tasks',
          {
            fields: new Set(['title', 'rating', 'remote']),
            views: new Set(['grid']),
            records: new Map([['row', new Set(['rating', 'remote'])]]),
          },
        ],
      ])
    );
    expect(result.tables[0].fields.find((f) => f.id === 'rating')?.options).toEqual({ max: 8 });
    expect(result.tables[0].records).toEqual([{ id: 'row', fields: { rating: 8 } }]);
    expect(JSON.stringify(result)).not.toMatch(/withheld|Read me/);
  });

  it('checks out the granted cell with its original type and compares its value across a conversion', async () => {
    const tableId = `tbl${'a'.repeat(16)}`;
    const title = `fld${'a'.repeat(16)}`;
    const estimate = `fld${'b'.repeat(16)}`;
    const rowId = `rec${'a'.repeat(16)}`;
    const builder = Table.builder()
      .withId(TableId.create(tableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Tasks')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(FieldId.create(title)._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(FieldId.create(estimate)._unsafeUnwrap())
      .withName(FieldName.create('Estimate')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const checkpoint = (revision: number, type: string, value: unknown): IBaseVcsSnapshot => ({
      ...snapshot,
      baseId: table.baseId().toString(),
      revision,
      tables: [
        {
          id: tableId,
          name: 'Former table name',
          primaryFieldId: title,
          fields: [
            {
              id: title,
              name: 'Former title',
              type: 'rating',
              options: { max: 10 },
              isPrimary: true,
              isComputed: false,
            },
            {
              id: estimate,
              name: 'Former estimate',
              type,
              isPrimary: false,
              isComputed: false,
              options: type === 'rating' ? { max: 10 } : { defaultValue: value },
              unique: true,
            },
          ],
          views: [],
          records: [{ id: rowId, fields: { [title]: 9, [estimate]: value } }],
        },
      ],
    });
    const before = checkpoint(1, 'longText', 'draft');
    const after = checkpoint(2, 'number', 7);
    const scope = {
      table,
      tableId,
      readableViewIds: new Set<string>(),
      recordHistoryOnly: true as const,
      historyFieldsForRecords: async () => new Map([[rowId, new Set([estimate])]]),
    };
    const queries = {
      execute: async () =>
        ok({ records: [{ id: rowId, fields: { [title]: 'Task', [estimate]: 7 } }] }),
    } as unknown as IQueryBus;
    const ctx = { actorId: ActorId.create('usr_history')._unsafeUnwrap() };
    const visibility = async (...endpoints: IBaseVcsSnapshot[]) =>
      (await readHistoryVisibility(ctx, queries, [scope], endpoints))._unsafeUnwrap();

    const checkout = projectHistoricalSnapshot(before, await visibility(before));
    const [projected] = checkout.tables;
    expect(projected.name).toBe('Tasks');
    expect(projected.fields.find((f) => f.id === title)).toMatchObject({
      name: 'Title',
      type: 'singleLineText',
    });
    expect(projected.fields.find((f) => f.id === estimate)).toEqual({
      id: estimate,
      name: 'Estimate',
      type: 'longText',
      isPrimary: false,
      isComputed: false,
    });
    expect(projected.records).toEqual([{ id: rowId, fields: { [estimate]: 'draft' } }]);
    const [physical] = historicalEngineSnapshot(checkout).tables;
    expect(physical.fields.find((f) => f.id === estimate)?.type).toBe('longText');
    expect(physical.records).toEqual(projected.records);

    const rated = checkpoint(3, 'rating', 9);
    const frozen = projectHistoricalSnapshot(rated, await visibility(rated));
    expect(frozen.tables[0].fields.find((f) => f.id === estimate)?.type).toBe('rating');
    const [hydrated] = historicalEngineSnapshot(frozen).tables;
    expect(hydrated.fields.find((f) => f.id === estimate)?.type).toBe('number');
    expect(hydrated.records[0].fields).toEqual({ [estimate]: 9 });

    const both = await visibility(before, after);
    const left = projectHistoricalSnapshot(before, both);
    const right = projectHistoricalSnapshot(after, both);
    for (const [from, to, oldValue, newValue] of [
      [left, right, 'draft', 7],
      [right, left, 7, 'draft'],
    ] as const) {
      const patch = diffSnapshots(from, to);
      expect(patch.tablesUpdated).toMatchObject([
        {
          fieldsAdded: [],
          fieldsUpdated: [],
          fieldsDeleted: [],
          recordsUpdated: [
            {
              recordId: rowId,
              cellChanges: [{ fieldId: estimate, before: oldValue, after: newValue }],
            },
          ],
        },
      ]);
    }
  });
});
