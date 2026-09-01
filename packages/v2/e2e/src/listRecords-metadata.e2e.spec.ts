import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 listRecords metadata contract (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let nameFieldId: string;
  let statusFieldId: string;
  let recordIds: string[];

  const listRecords = async (input: Record<string, string>) => {
    for (let i = 0; i < 10; i += 1) {
      if ((await ctx.testContainer.processOutbox()) === 0) break;
    }

    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      ...input,
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`);
    const rawBody = await response.json();
    expect(response.status).toBe(200);
    return { rawBody, parsed: listTableRecordsOkResponseSchema.parse(rawBody) };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'List Records Metadata Contract',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Status', type: 'singleSelect', options: ['Open', 'Closed'] },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    nameFieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';
    statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    const records = await ctx.createRecords(tableId, [
      { fields: { [nameFieldId]: 'match first', [statusFieldId]: 'Open' } },
      { fields: { [nameFieldId]: 'middle', [statusFieldId]: 'Closed' } },
      { fields: { [nameFieldId]: 'match last', [statusFieldId]: 'Open' } },
    ]);
    recordIds = records.map((record) => record.id);
  }, 60000);

  it('returns grouped counts from the full query scope when explicitly requested', async () => {
    const { rawBody, parsed } = await listRecords({
      groupBy: JSON.stringify([statusFieldId]),
      includeGroups: 'true',
      limit: '1',
      offset: '1',
    });

    expect(parsed.ok).toBe(true);
    expect(rawBody).toMatchObject({
      ok: true,
      data: {
        groups: [
          { fields: { [statusFieldId]: 'Open' }, count: 2 },
          { fields: { [statusFieldId]: 'Closed' }, count: 1 },
        ],
      },
    });
  });

  it.each([
    { mode: 'matched', expectedIndex: 2 },
    { mode: 'view', expectedIndex: 3 },
  ] as const)(
    'returns $mode search match indexes after pagination',
    async ({ mode, expectedIndex }) => {
      const { rawBody, parsed } = await listRecords({
        search: JSON.stringify(['match', nameFieldId, true]),
        includeSearchMatches: 'true',
        searchIndexMode: mode,
        projection: JSON.stringify([nameFieldId]),
        limit: '1',
        offset: '1',
      });

      expect(parsed.ok).toBe(true);
      expect(rawBody).toMatchObject({
        ok: true,
        data: {
          searchMatches: [
            {
              index: expectedIndex,
              fieldId: nameFieldId,
              recordId: recordIds[2],
            },
          ],
        },
      });
    }
  );
});
