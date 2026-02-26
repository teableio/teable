import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IFilter, IGroup } from '@teable/core';
import { Colors, FieldKeyType, FieldType, SortFunc } from '@teable/core';
import {
  CommentNodeType,
  GroupPointType,
  createComment,
  getCommentCount,
} from '@teable/openapi';
import type { IGroupHeaderPoint, ITableFullVo } from '@teable/openapi';
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

    const sourceKeyField = sourceTable.fields.find(
      ({ name }) => name === 'LookupKey'
    ) as IFieldVo;
    const sourceCategoryField = sourceTable.fields.find(
      ({ name }) => name === 'Category'
    ) as IFieldVo;
    const hostKeyField = hostTable.fields.find(
      ({ name }) => name === 'LookupKey'
    ) as IFieldVo;

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

    await createComment(hostTable.id, hostTable.records[0].id, {
      content: [
        {
          type: CommentNodeType.Paragraph,
          children: [{ type: CommentNodeType.Text, value: 'host-1' }],
        },
      ],
      quoteId: null,
    });
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

  it('should not throw filterInvalidOperator when collapsed groups are provided', async () => {
    const groupBy: IGroup = [{ fieldId: groupedLookupFieldId, order: SortFunc.Asc }];

    const groupedRecords = await getRecords(hostTable.id, {
      fieldKeyType: FieldKeyType.Id,
      groupBy,
    });

    const firstGroupHeader = groupedRecords.extra?.groupPoints?.find(
      (point): point is IGroupHeaderPoint =>
        point.type === GroupPointType.Header && point.depth === 0
    );
    expect(firstGroupHeader).toBeDefined();

    const response = await getCommentCount(hostTable.id, {
      viewId: hostTable.views[0].id,
      type: 'rec',
      take: 300,
      skip: 0,
      groupBy,
      collapsedGroupIds: [firstGroupHeader!.id],
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);
  });
});
