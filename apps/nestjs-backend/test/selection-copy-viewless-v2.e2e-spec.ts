import type { INestApplication } from '@nestjs/common';
import {
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  SortFunc,
  TimeFormatting,
} from '@teable/core';
import {
  RangeType,
  USER_ME,
  X_CANARY_HEADER,
  axios,
  getRecords,
  updateViewColumnMeta,
  updateViewFilter,
  updateViewSort,
  type ICopyVo,
  type IRangesRo,
  type ITableFullVo,
  type IUserMeVo,
} from '@teable/openapi';
import { vi } from 'vitest';
import { thresholdConfig, type IThresholdConfig } from '../src/configs/threshold.config';
import { SelectionService } from '../src/features/selection/selection.service';
import { createField, createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Viewless selection copy HTTP contract (T8468)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;
  const tableIds = new Set<string>();
  const cells = [
    ['zeta', '30', 'Z', 'B'],
    ['alpha', '10', 'A', 'A'],
    ['beta', '20', 'B', 'A'],
    ['gamma', '40', 'G', 'B'],
  ];

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    ({ app } = await initApp());
    table = await createTable(baseId, {
      name: 'T8468 table coordinates versus saved view',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Score',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
        },
        { name: 'Note', type: FieldType.LongText },
        { name: 'Bucket', type: FieldType.SingleLineText },
      ],
      records: cells.map(([title, score, note, bucket]) => ({
        fields: { Title: title, Score: Number(score), Note: note, Bucket: bucket },
      })),
    });
    tableIds.add(table.id);
    const [title, score, note, bucket] = table.fields;
    await updateViewColumnMeta(table.id, table.views[0].id, [
      { fieldId: title.id, columnMeta: { order: 2 } },
      { fieldId: score.id, columnMeta: { order: 1 } },
      { fieldId: note.id, columnMeta: { order: 0, hidden: true } },
      { fieldId: bucket.id, columnMeta: { order: 3 } },
    ]);
    await updateViewFilter(table.id, table.views[0].id, {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: bucket.id, operator: 'is', value: 'A' }],
      },
    });
    await updateViewSort(table.id, table.views[0].id, {
      sort: { sortObjs: [{ fieldId: score.id, order: SortFunc.Desc }], manualSort: false },
    });
  });

  afterAll(async () => {
    for (const tableId of [...tableIds].reverse()) await permanentDeleteTable(baseId, tableId);
    if (app) await app.close();
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  });

  const copy = (tableId: string, query: IRangesRo, useV2: boolean) =>
    axios.get<ICopyVo>(`/table/${tableId}/selection/copy`, {
      headers: { [X_CANARY_HEADER]: String(useV2) },
      params: {
        ...query,
        ranges: JSON.stringify(query.ranges),
        filter: JSON.stringify(query.filter),
        orderBy: JSON.stringify(query.orderBy),
        groupBy: JSON.stringify(query.groupBy),
        collapsedGroupIds: JSON.stringify(query.collapsedGroupIds),
      },
      validateStatus: () => true,
    });

  const expectCopy = async (
    query: IRangesRo,
    fieldIndexes: number[],
    rows: string[][],
    source = table,
    content = rows.map((row) => row.join('\t')).join('\n'),
    rawContent?: unknown[][]
  ) => {
    for (const useV2 of [false, true]) {
      const response = await copy(source.id, query, useV2);
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.headers['x-teable-v2']).toBe(String(useV2));
      expect(response.data.content).toBe(content);
      expect(response.data.header.map((field) => field.id)).toEqual(
        fieldIndexes.map((index) => source.fields[index].id)
      );
      expect(response.data.header.map((field) => field.type)).toEqual(
        fieldIndexes.map((index) => source.fields[index].type)
      );
      expect(response.data.rawContent).toEqual(rawContent);
    }
  };

  it('serves viewless clipboard cells when the retired copy engine is unavailable', async () => {
    const unavailableLegacyCopy = vi
      .spyOn(app.get(SelectionService), 'copy')
      .mockRejectedValue(new Error('Retired copy engine is unavailable'));
    try {
      const response = await copy(
        table.id,
        {
          ranges: [
            [0, 0],
            [1, 1],
          ],
        },
        true
      );
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data.content).toBe('zeta\t30\nalpha\t10');
      expect(response.data.header.map((field) => field.id)).toEqual([
        table.fields[0].id,
        table.fields[1].id,
      ]);
      expect(response.data.header.map((field) => field.type)).toEqual([
        FieldType.SingleLineText,
        FieldType.Number,
      ]);
    } finally {
      unavailableLegacyCopy.mockRestore();
    }
  });

  it('uses table row and field coordinates instead of the saved default view', async () => {
    await expectCopy(
      {
        ranges: [
          [0, 0],
          [3, 3],
        ],
      },
      [0, 1, 2, 3],
      cells
    );
    await expectCopy(
      {
        ranges: [
          [1, 1],
          [2, 2],
        ],
      },
      [1, 2],
      [
        ['10', 'A'],
        ['20', 'B'],
      ]
    );
    // This is intentionally different: saved filter, descending sort, hiding and order apply.
    await expectCopy(
      {
        viewId: table.views[0].id,
        ranges: [
          [0, 0],
          [2, 1],
        ],
      },
      [1, 0, 3],
      [
        ['20', 'beta', 'A'],
        ['10', 'alpha', 'A'],
      ]
    );
  });

  it('copies row/column ranges including noncontiguous selections in requested order', async () => {
    await expectCopy({ type: RangeType.Rows, ranges: [[1, 2]] }, [0, 1, 2, 3], cells.slice(1, 3));
    await expectCopy(
      {
        type: RangeType.Rows,
        ranges: [
          [3, 3],
          [0, 0],
        ],
      },
      [0, 1, 2, 3],
      [cells[3], cells[0]]
    );
    await expectCopy(
      { type: RangeType.Columns, ranges: [[1, 2]] },
      [1, 2],
      cells.map((row) => row.slice(1, 3))
    );
    await expectCopy(
      {
        type: RangeType.Columns,
        ranges: [
          [3, 3],
          [0, 0],
        ],
      },
      [3, 0],
      cells.map((row) => [row[3], row[0]])
    );
  });

  it('uses an explicit projection subset and order as the coordinate space, even for hidden fields', async () => {
    const projection = [table.fields[2].id, table.fields[0].id];
    await expectCopy(
      {
        projection,
        ranges: [
          [0, 0],
          [1, 1],
        ],
      },
      [2, 0],
      [
        ['Z', 'zeta'],
        ['A', 'alpha'],
      ]
    );
    await expectCopy(
      {
        projection,
        type: RangeType.Rows,
        ranges: [
          [2, 2],
          [0, 0],
        ],
      },
      [2, 0],
      [
        ['B', 'beta'],
        ['Z', 'zeta'],
      ]
    );
    await expectCopy(
      { projection, type: RangeType.Columns, ranges: [[1, 1]] },
      [0],
      cells.map((row) => [row[0]])
    );
    await expectCopy(
      {
        viewId: table.views[0].id,
        projection,
        ranges: [
          [0, 0],
          [1, 1],
        ],
      },
      [2, 0],
      [
        ['B', 'beta'],
        ['A', 'alpha'],
      ]
    );
  });

  it('honors explicit filtering, sorting, search and grouping without inheriting saved queries', async () => {
    const projection = [table.fields[0].id];
    await expectCopy(
      {
        projection,
        type: RangeType.Columns,
        ranges: [[0, 0]],
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: table.fields[3].id, operator: 'is', value: 'B' }],
        },
        orderBy: [{ fieldId: table.fields[1].id, order: SortFunc.Desc }],
      },
      [0],
      [['gamma'], ['zeta']]
    );
    await expectCopy(
      {
        projection,
        type: RangeType.Columns,
        ranges: [[0, 0]],
        search: ['beta', table.fields[0].id, true],
      },
      [0],
      [['beta']]
    );
    await expectCopy(
      {
        projection,
        type: RangeType.Columns,
        ranges: [[0, 0]],
        groupBy: [{ fieldId: table.fields[3].id, order: SortFunc.Asc }],
        orderBy: [{ fieldId: table.fields[1].id, order: SortFunc.Desc }],
      },
      [0],
      [['beta'], ['alpha'], ['gamma'], ['zeta']]
    );
  });

  it('excludes collapsed groups from content but counts all matching rows against the column cap', async () => {
    const groupBy = [{ fieldId: table.fields[3].id, order: SortFunc.Asc }];
    const orderBy = [{ fieldId: table.fields[1].id, order: SortFunc.Desc }];
    const grouped = await getRecords(table.id, {
      viewId: table.views[0].id,
      ignoreViewQuery: true,
      groupBy,
      orderBy,
      fieldKeyType: FieldKeyType.Id,
      includeQueryExtra: true,
    });
    expect(grouped.data.records.map((record) => record.fields[table.fields[0].id])).toEqual([
      'beta',
      'alpha',
      'gamma',
      'zeta',
    ]);
    const firstGroup = grouped.data.extra?.groupPoints?.find(
      (point) => point.type === 0 && 'id' in point
    );
    if (!firstGroup || !('id' in firstGroup) || typeof firstGroup.id !== 'string') {
      throw new Error('Expected a real group header from the grouped records response');
    }
    const query: IRangesRo = {
      projection: [table.fields[0].id],
      type: RangeType.Columns,
      ranges: [[0, 0]],
      groupBy,
      orderBy,
      collapsedGroupIds: [firstGroup.id],
    };
    const config = app.get<IThresholdConfig>(thresholdConfig.KEY);
    const previousMaxCopyCells = config.maxCopyCells;
    try {
      config.maxCopyCells = 4;
      await expectCopy(query, [0], [['gamma'], ['zeta']]);
      config.maxCopyCells = 3;
      for (const useV2 of [false, true]) {
        const response = await copy(table.id, query, useV2);
        expect(response.status).toBe(400);
        expect(response.data).toMatchObject({
          data: { localization: { i18nKey: 'httpErrors.selection.exceedMaxCopyCells' } },
        });
      }
    } finally {
      config.maxCopyCells = previousMaxCopyCells;
    }
  });

  it('preserves clipboard escaping, typed formatting, empty cells and raw user identity', async () => {
    const user = (await axios.get<IUserMeVo>(USER_ME)).data;
    const identity = { id: user.id, title: user.name, email: user.email };
    const typed = await createTable(baseId, {
      name: 'T8468 clipboard values',
      fields: [
        { name: 'Text', type: FieldType.LongText },
        {
          name: 'Number',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 1 } },
        },
        { name: 'Checked', type: FieldType.Checkbox },
        { name: 'Owner', type: FieldType.User, options: { shouldNotify: false } },
        {
          name: 'Date',
          type: FieldType.Date,
          options: {
            formatting: { date: 'YYYY-MMM-DD', time: TimeFormatting.None, timeZone: 'UTC' },
          },
        },
      ],
      records: [
        {
          fields: {
            Text: 'quote "only"',
            Number: 12.5,
            Checked: true,
            Owner: identity,
            Date: '2023-07-12T00:00:00.000Z',
          },
        },
        { fields: { Text: 'tab\t"quoted"\nline' } },
        { fields: {} },
      ],
    });
    tableIds.add(typed.id);
    const formula = await createField(typed.id, {
      name: 'Computed',
      type: FieldType.Formula,
      options: {
        expression: '1 + 2',
        formatting: { type: NumberFormattingType.Decimal, precision: 0 },
      },
    });
    typed.fields.push(formula);
    await expectCopy(
      {
        ranges: [
          [0, 0],
          [5, 2],
        ],
      },
      [0, 1, 2, 3, 4, 5],
      [],
      typed,
      `quote "only"\t12.5\ttrue\t${user.name}\t2023-Jul-12\t3\n"tab\t""quoted""\nline"\t\t\t\t\t3\n\t\t\t\t\t3`,
      [
        ['quote "only"', '12.5', 'true', identity, '2023-Jul-12', '3'],
        ['tab\t"quoted"\nline', '', '', null, '', '3'],
        ['', '', '', null, '', '3'],
      ]
    );
  });

  it('rejects negative row coordinates without returning clipboard cells', async () => {
    const queries: IRangesRo[] = [
      {
        ranges: [
          [0, -2],
          [1, -1],
        ],
      },
      { type: RangeType.Rows, ranges: [[-2, -1]] },
    ];
    for (const query of queries) {
      for (const useV2 of [false, true]) {
        const response = await copy(table.id, query, useV2);
        if (useV2) {
          expect(response.status).toBe(400);
        } else {
          // Legacy query offsets reject these too; its incidental error status is not a contract.
          expect(response.status).toBeGreaterThanOrEqual(400);
        }
        expect(response.data).not.toHaveProperty('content');
        expect(response.data).not.toHaveProperty('rawContent');
        expect(response.data).not.toHaveProperty('header');
      }
    }
  });

  it('returns empty selected results and rejects invalid empty ranges', async () => {
    await expectCopy(
      {
        ranges: [
          [0, 0],
          [1, 0],
        ],
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: table.fields[0].id, operator: 'is', value: 'absent' }],
        },
      },
      [0, 1],
      []
    );
    for (const useV2 of [false, true]) {
      const response = await copy(table.id, { ranges: [] }, useV2);
      expect(response.status).toBe(400);
    }
  });

  it('allows the exact copy-cell cap and rejects oversized rectangle, row and column selections', async () => {
    const config = app.get<IThresholdConfig>(thresholdConfig.KEY);
    const previousMaxCopyCells = config.maxCopyCells;
    try {
      config.maxCopyCells = 16;
      await expectCopy(
        {
          ranges: [
            [0, 0],
            [3, 3],
          ],
        },
        [0, 1, 2, 3],
        cells
      );
      config.maxCopyCells = 15;
      const queries: IRangesRo[] = [
        {
          ranges: [
            [0, 0],
            [3, 3],
          ],
        },
        { type: RangeType.Rows, ranges: [[0, 3]] },
        { type: RangeType.Columns, ranges: [[0, 3]] },
        // Requested coordinates consume quota even when rows/columns do not exist.
        {
          ranges: [
            [0, 100],
            [3, 103],
          ],
        },
        { type: RangeType.Rows, ranges: [[100, 103]] },
        { type: RangeType.Columns, ranges: [[100, 103]] },
      ];
      for (const query of queries) {
        for (const useV2 of [false, true]) {
          const response = await copy(table.id, query, useV2);
          expect(response.status).toBe(400);
          expect(response.data).toMatchObject({
            data: { localization: { i18nKey: 'httpErrors.selection.exceedMaxCopyCells' } },
          });
        }
      }
    } finally {
      config.maxCopyCells = previousMaxCopyCells;
    }
  });
});
