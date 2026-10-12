import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IFilter, IGroup } from '@teable/core';
import {
  Colors,
  DateFormattingPreset,
  FieldKeyType,
  FieldType,
  SortFunc,
  TimeFormatting,
} from '@teable/core';
import { CommentNodeType, GroupPointType, createComment, getCommentCount } from '@teable/openapi';
import type { IGetRecordsRo, IGroupHeaderPoint, ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  getField,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('OpenAPI Comment count with collapsed groups (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  let sourceTable: ITableFullVo;
  let hostTable: ITableFullVo;
  let groupedLookupFieldId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    sourceTable = await createTable(baseId, {
      name: 'comment_count_group_source',
      fields: [
        { name: 'LookupKey', type: FieldType.SingleLineText },
        {
          name: 'Category',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { id: 'choice-1', name: 'Alpha', color: Colors.Blue },
              { id: 'choice-2', name: 'Beta', color: Colors.Green },
              { id: 'choice-3', name: 'Gamma', color: Colors.Orange },
            ],
          },
        },
      ],
      records: [
        { fields: { LookupKey: 'K-1', Category: 'Alpha' } },
        { fields: { LookupKey: 'K-1', Category: 'Beta' } },
        { fields: { LookupKey: 'K-2', Category: 'Gamma' } },
      ],
    });

    hostTable = await createTable(baseId, {
      name: 'comment_count_group_host',
      fields: [{ name: 'LookupKey', type: FieldType.SingleLineText }],
      records: [{ fields: { LookupKey: 'K-1' } }, { fields: { LookupKey: 'K-2' } }],
    });

    const sourceKeyField = sourceTable.fields.find(({ name }) => name === 'LookupKey') as IFieldVo;
    const sourceCategoryField = sourceTable.fields.find(
      ({ name }) => name === 'Category'
    ) as IFieldVo;
    const hostKeyField = hostTable.fields.find(({ name }) => name === 'LookupKey') as IFieldVo;

    const matchByKeyFilter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: sourceKeyField.id,
          operator: 'is',
          value: { type: 'field', fieldId: hostKeyField.id },
        },
      ],
    };

    const groupedLookupField = await createField(hostTable.id, {
      name: 'GroupedCategory',
      type: FieldType.SingleSelect,
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: sourceTable.id,
        lookupFieldId: sourceCategoryField.id,
        filter: matchByKeyFilter,
      },
    });

    groupedLookupFieldId = groupedLookupField.id;
    const refreshedLookupField = await getField(hostTable.id, groupedLookupFieldId);
    expect(refreshedLookupField.isMultipleCellValue).toBe(true);

    for (const record of hostTable.records) {
      await createComment(hostTable.id, record.id, {
        content: [
          {
            type: CommentNodeType.Paragraph,
            children: [{ type: CommentNodeType.Text, value: 'Grouped record comment' }],
          },
        ],
        quoteId: null,
      });
    }
  });

  afterAll(async () => {
    if (hostTable?.id) {
      await permanentDeleteTable(baseId, hostTable.id);
    }
    if (sourceTable?.id) {
      await permanentDeleteTable(baseId, sourceTable.id);
    }
    await app.close();
  });

  it('returns comment counts only for records outside collapsed lookup groups', async () => {
    const groupBy: IGroup = [{ fieldId: groupedLookupFieldId, order: SortFunc.Asc }];

    const groupedRecords = await getRecords(hostTable.id, {
      fieldKeyType: FieldKeyType.Id,
      groupBy,
    });

    const collapsedGroupHeader = groupedRecords.extra?.groupPoints?.find(
      (point): point is IGroupHeaderPoint =>
        point.type === GroupPointType.Header &&
        point.depth === 0 &&
        Array.isArray(point.value) &&
        point.value.includes('Gamma')
    );
    expect(collapsedGroupHeader).toBeDefined();

    const query: IGetRecordsRo = {
      viewId: hostTable.views[0].id,
      type: 'rec',
      take: 300,
      skip: 0,
      groupBy,
      collapsedGroupIds: [collapsedGroupHeader!.id],
    };
    const visibleRecords = await getRecords(hostTable.id, query);
    expect(visibleRecords.records.map(({ id }) => id)).toEqual([hostTable.records[0].id]);

    const response = await getCommentCount(hostTable.id, {
      recordIds: visibleRecords.records.map(({ id }) => id),
    });
    expect(response.data).toEqual([{ recordId: hostTable.records[0].id, count: 1 }]);
    expect(response.data.map(({ recordId }) => recordId)).toEqual(
      visibleRecords.records.map(({ id }) => id)
    );

    // The collapsed Gamma group sorts first: exclusion must precede the page limit.
    const firstVisiblePage: IGetRecordsRo = {
      ...query,
      groupBy: [{ fieldId: groupedLookupFieldId, order: SortFunc.Desc }],
      take: 1,
    };
    const firstPage = await getRecords(hostTable.id, firstVisiblePage);
    expect(firstPage.records.map(({ id }) => id)).toEqual([hostTable.records[0].id]);
    expect(
      (await getCommentCount(hostTable.id, { recordIds: firstPage.records.map(({ id }) => id) }))
        .data
    ).toEqual([{ recordId: hostTable.records[0].id, count: 1 }]);
    const nextPage = await getRecords(hostTable.id, { ...firstVisiblePage, skip: 1 });
    expect(nextPage.records).toEqual([]);
    expect(
      (await getCommentCount(hostTable.id, { recordIds: nextPage.records.map(({ id }) => id) }))
        .data
    ).toEqual([]);
  });

  it('excludes an entire formatted date group across distinct timestamps', async () => {
    const table = await createTable(baseId, {
      name: 'comment_count_date_groups',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'Asia/Shanghai',
            },
          },
        },
      ],
      records: [
        { fields: { Name: 'First', Date: '2026-04-11T17:00:00.000Z' } },
        { fields: { Name: 'Second', Date: '2026-04-12T14:00:00.000Z' } },
        { fields: { Name: 'Next day', Date: '2026-04-13T01:00:00.000Z' } },
      ],
    });
    try {
      for (const record of table.records) {
        await createComment(table.id, record.id, {
          content: [
            {
              type: CommentNodeType.Paragraph,
              children: [{ type: CommentNodeType.Text, value: 'Date group comment' }],
            },
          ],
          quoteId: null,
        });
      }
      const groupBy: IGroup = [
        { fieldId: table.fields.find(({ name }) => name === 'Date')!.id, order: SortFunc.Asc },
      ];
      const grouped = await getRecords(table.id, { groupBy });
      const header = grouped.extra?.groupPoints?.find(
        (point): point is IGroupHeaderPoint => point.type === GroupPointType.Header
      );
      expect(header).toBeDefined();
      const query: IGetRecordsRo = {
        viewId: table.views[0].id,
        groupBy,
        collapsedGroupIds: [header!.id],
        take: 1,
      };
      const visibleRecords = await getRecords(table.id, query);
      expect(visibleRecords.records.map(({ id }) => id)).toEqual([table.records[2].id]);
      expect(
        (
          await getCommentCount(table.id, {
            recordIds: visibleRecords.records.map(({ id }) => id),
          })
        ).data
      ).toEqual([{ recordId: table.records[2].id, count: 1 }]);
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
