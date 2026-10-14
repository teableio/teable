/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldKeyType,
  FieldType,
  generateWorkflowId,
  SortFunc,
  StatisticsFunc,
} from '@teable/core';
import type { IGroupHeaderPoint } from '@teable/openapi';
import {
  axios,
  buttonClick,
  buttonReset,
  getAggregation,
  getSelectionAggregation,
  GroupPointType,
  updateViewGroup,
} from '@teable/openapi';
import {
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;
beforeAll(async () => {
  app = (await initApp()).app;
});
afterAll(async () => {
  await app.close();
});
describe('button count grouping and collapsed queries (T7781)', () => {
  const previousForceV2 = process.env.FORCE_V2_ALL;
  beforeAll(() => {
    process.env.FORCE_V2_ALL = 'true';
  });
  afterAll(() => {
    if (previousForceV2 == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2;
  });

  it('keeps records, socket ids, group statistics and collapsed selection consistent after real clicks', async () => {
    const table = await createTable(baseId, {
      name: 'Button Group Regression',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: [
        { fields: { Name: 'once', Amount: 10 } },
        { fields: { Name: 'twice', Amount: 20 } },
        { fields: { Name: 'untouched', Amount: 30 } },
        { fields: { Name: 'also once', Amount: 40 } },
      ],
    });
    try {
      const button = await createField(table.id, {
        name: 'Action',
        type: FieldType.Button,
        options: {
          label: 'Run',
          color: Colors.Teal,
          resetCount: true,
          workflow: { id: generateWorkflowId(), name: 'Button workflow', isActive: true },
        },
      });
      const amount = table.fields.find((field) => field.name === 'Amount')!;
      const viewId = table.views[0].id;
      for (const index of [0, 1, 1, 3]) {
        const clicked = await buttonClick(table.id, table.records[index].id, button.id);
        expect(clicked.headers['x-teable-v2']).toBe('true');
      }
      const groupBy = [{ fieldId: button.id, order: SortFunc.Asc }];
      await updateViewGroup(table.id, viewId, { group: groupBy });
      const query = { viewId, groupBy, fieldKeyType: FieldKeyType.Id };
      const grouped = await getRecords(table.id, query);
      const headers = grouped.extra!.groupPoints!.filter(
        (point): point is IGroupHeaderPoint => point.type === GroupPointType.Header
      );
      expect(headers.map((header) => header.value ?? null)).toEqual([
        null,
        { count: 1 },
        { count: 2 },
      ]);
      expect(grouped.records.map((record) => record.fields[button.id] ?? null)).toEqual([
        null,
        { count: 1 },
        { count: 1 },
        { count: 2 },
      ]);
      const aggregates = (
        await getAggregation(table.id, {
          ...query,
          field: { [StatisticsFunc.Sum]: [amount.id] },
        })
      ).data.aggregations!.find((item) => item.fieldId === amount.id)!;
      expect(headers.map((header) => aggregates.group?.[header.id]?.value)).toEqual([30, 50, 20]);
      const excludedRecordIds = [
        [table.records[2].id],
        [table.records[0].id, table.records[3].id],
        [table.records[1].id],
      ];
      for (const [index, header] of headers.entries()) {
        const collapsedQuery = { ...query, collapsedGroupIds: [header.id] };
        const expectedIds = grouped.records
          .filter((record) => !excludedRecordIds[index].includes(record.id))
          .map((record) => record.id);
        expect(
          (await getRecords(table.id, collapsedQuery)).records.map((record) => record.id)
        ).toEqual(expectedIds);
        const socket = await axios.post<{ ids: string[] }>(
          `/table/${table.id}/record/socket/doc-ids`,
          collapsedQuery
        );
        expect(socket.data.ids).toEqual(expectedIds);
        const selection = await getSelectionAggregation(table.id, {
          ...collapsedQuery,
          skip: 0,
          take: 4,
          field: { [StatisticsFunc.Sum]: [amount.id] },
        });
        expect(selection.data.aggregations![0].total?.value).toBe([70, 50, 80][index]);
      }
      await buttonReset(table.id, table.records[0].id, button.id);
      const reset = await getRecords(table.id, query);
      expect(
        reset.records
          .filter((record) => record.fields[button.id] == null)
          .map((record) => record.id)
      ).toEqual([table.records[0].id, table.records[2].id]);
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
