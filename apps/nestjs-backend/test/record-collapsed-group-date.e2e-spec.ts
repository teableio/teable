import type { INestApplication } from '@nestjs/common';
import type { IGroup } from '@teable/core';
import { FieldKeyType, FieldType, SortFunc, TimeFormatting } from '@teable/core';
import { GroupPointType, axios, urlBuilder } from '@teable/openapi';
import type { IGroupHeaderPoint, ITableFullVo } from '@teable/openapi';
import { createTable, getRecords, initApp, permanentDeleteTable } from './utils/init-app';

// Regression for T6856: collapsing a date group must exclude exactly that group's
// rows, independent of the server process timezone (e2e always runs with TZ=UTC).
describe('OpenAPI collapsed date group (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  const getDocIds = async (tableId: string, query: Record<string, unknown>) => {
    const res = await axios.post<{ ids: string[] }>(
      urlBuilder('/table/{tableId}/record/socket/doc-ids', { tableId }),
      query
    );
    expect(res.status).toBe(201);
    return res.data.ids;
  };

  it.each([
    // Field-timezone midnights chosen so the group day differs from the UTC day.
    {
      timeZone: 'Asia/Shanghai',
      firstGroupDate: '2025-10-31T16:00:00.000Z',
      secondGroupDate: '2025-11-30T16:00:00.000Z',
    },
    {
      timeZone: 'UTC',
      firstGroupDate: '2025-11-01T00:00:00.000Z',
      secondGroupDate: '2025-12-01T00:00:00.000Z',
    },
    {
      timeZone: 'America/New_York',
      firstGroupDate: '2025-11-01T05:00:00.000Z',
      secondGroupDate: '2025-12-01T05:00:00.000Z',
    },
  ])(
    'excludes only the collapsed group rows (field timezone $timeZone)',
    async ({ timeZone, firstGroupDate, secondGroupDate }) => {
      let table: ITableFullVo | undefined;
      try {
        table = await createTable(baseId, {
          name: `collapsed_date_group_${timeZone.replace(/\W/g, '_')}`,
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            {
              name: 'When',
              type: FieldType.Date,
              options: {
                formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.None, timeZone },
              },
            },
          ],
          records: [
            { fields: { Title: 'nov-a', When: firstGroupDate } },
            { fields: { Title: 'nov-b', When: firstGroupDate } },
            { fields: { Title: 'dec-a', When: secondGroupDate } },
          ],
        });

        const dateFieldId = table.fields.find(({ name }) => name === 'When')!.id;
        const viewId = table.views[0].id;
        const groupBy: IGroup = [{ fieldId: dateFieldId, order: SortFunc.Asc }];
        const [novAId, novBId, decAId] = table.records.map(({ id }) => id);

        const grouped = await getRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          viewId,
          groupBy,
        });
        const headers = (grouped.extra?.groupPoints ?? []).filter(
          (point): point is IGroupHeaderPoint => point.type === GroupPointType.Header
        );
        expect(headers.length).toBe(2);

        const allIds = await getDocIds(table.id, { viewId, groupBy });
        expect([...allIds].sort()).toEqual([novAId, novBId, decAId].sort());

        // Collapse the first (ascending) group: both of its rows must disappear
        // while the other group's row stays visible.
        const visibleIds = await getDocIds(table.id, {
          viewId,
          groupBy,
          collapsedGroupIds: [headers[0].id],
        });
        expect(visibleIds).toEqual([decAId]);
      } finally {
        if (table?.id) {
          await permanentDeleteTable(baseId, table.id);
        }
      }
    }
  );
});
