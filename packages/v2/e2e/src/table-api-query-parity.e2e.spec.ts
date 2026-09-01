/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  GetCalendarDailyCollectionQuery,
  type GetCalendarDailyCollectionResult,
  GetFieldFilterLinkRecordsQuery,
  type GetViewFilterLinkRecordsResult,
  GetRecordCollaboratorsQuery,
  type GetRecordCollaboratorsResult,
  GetRecordStatusQuery,
  type GetRecordStatusResult,
  GetViewSelectionCopyQuery,
  type GetViewSelectionCopyResult,
  type IQueryBus,
  v2CoreTokens,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

describe('remaining table API queries (e2e, v1 integration parity)', () => {
  let ctx: SharedTestContext;
  let queryBus: IQueryBus;
  const actorId = ActorId.create(TEST_USER.id)._unsafeUnwrap();

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    queryBus = ctx.testContainer.container.resolve<IQueryBus>(v2CoreTokens.queryBus);
  }, 30000);

  describe('GetFieldFilterLinkRecordsQuery', () => {
    const tableIds: string[] = [];
    let hostTableId: string;
    let filteredLinkFieldId: string;
    let targetOneId: string;
    let targetTwoId: string;
    let targetOneRecordIds: string[];
    let targetTwoRecordIds: string[];

    const makeTargetTable = async (name: string, prefix: string) => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name,
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid', name: 'Grid' }],
      });
      tableIds.push(table.id);
      const titleFieldId = table.fields[0]?.id ?? '';
      const records = await ctx.createRecords(table.id, [
        { fields: { [titleFieldId]: `${prefix}_record1` } },
        { fields: { [titleFieldId]: `${prefix}_record2` } },
        { fields: { [titleFieldId]: `${prefix}_record3` } },
      ]);
      return {
        id: table.id,
        titleFieldId,
        recordIds: records.map((record) => record.id),
      };
    };

    beforeAll(async () => {
      const targetOne = await makeTargetTable('Field Filter Target One', 'target_one');
      const targetTwo = await makeTargetTable('Field Filter Target Two', 'target_two');
      targetOneId = targetOne.id;
      targetTwoId = targetTwo.id;
      targetOneRecordIds = targetOne.recordIds;
      targetTwoRecordIds = targetTwo.recordIds;

      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Field Filter Foreign',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Target One',
            options: {
              relationship: 'manyOne',
              foreignTableId: targetOne.id,
              lookupFieldId: targetOne.titleFieldId,
              isOneWay: true,
            },
          },
          {
            type: 'link',
            name: 'Target Two',
            options: {
              relationship: 'manyOne',
              foreignTableId: targetTwo.id,
              lookupFieldId: targetTwo.titleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid', name: 'Grid' }],
      });
      tableIds.push(foreign.id);
      const targetOneLinkId = foreign.fields.find((field) => field.name === 'Target One')?.id ?? '';
      const targetTwoLinkId = foreign.fields.find((field) => field.name === 'Target Two')?.id ?? '';
      const foreignPrimaryFieldId = foreign.fields.find((field) => field.isPrimary)?.id ?? '';
      if (!targetOneLinkId || !targetTwoLinkId || !foreignPrimaryFieldId) {
        throw new Error('Field filter foreign fixture is incomplete');
      }

      const missingRecordId = `rec${'z'.repeat(16)}`;
      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Field Filter Host',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Filtered Foreign',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
              filter: {
                conjunction: 'and',
                filterSet: [
                  { fieldId: targetOneLinkId, operator: 'is', value: targetOneRecordIds[0] },
                  {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: targetOneLinkId,
                        operator: 'isAnyOf',
                        value: [...targetOneRecordIds, missingRecordId],
                      },
                    ],
                  },
                  { fieldId: targetTwoLinkId, operator: 'is', value: targetTwoRecordIds[0] },
                  {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: targetTwoLinkId,
                        operator: 'isAnyOf',
                        value: [targetTwoRecordIds[2]],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
        views: [{ type: 'grid', name: 'Grid' }],
      });
      tableIds.push(host.id);
      hostTableId = host.id;
      filteredLinkFieldId =
        host.fields.find((field) => field.name === 'Filtered Foreign')?.id ?? '';
      if (!filteredLinkFieldId) throw new Error('Field filter host fixture is incomplete');
    });

    afterAll(async () => {
      for (const tableId of [...tableIds].reverse()) {
        await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
      }
    });

    it('loads nested, deduplicated Link record references and ignores missing records', async () => {
      const query = GetFieldFilterLinkRecordsQuery.create({
        tableId: hostTableId,
        fieldId: filteredLinkFieldId,
      })._unsafeUnwrap();
      const result = await queryBus.execute<
        GetFieldFilterLinkRecordsQuery,
        GetViewFilterLinkRecordsResult
      >({ actorId, windowId: 'field-filter-link-e2e' }, query);

      expect(result.isOk(), result.isErr() ? result.error.message : undefined).toBe(true);
      if (result.isErr()) return;
      expect(result.value.groups).toEqual([
        {
          tableId: targetOneId,
          records: [
            { id: targetOneRecordIds[0], title: 'target_one_record1' },
            { id: targetOneRecordIds[1], title: 'target_one_record2' },
            { id: targetOneRecordIds[2], title: 'target_one_record3' },
          ],
        },
        {
          tableId: targetTwoId,
          records: [
            { id: targetTwoRecordIds[0], title: 'target_two_record1' },
            { id: targetTwoRecordIds[2], title: 'target_two_record3' },
          ],
        },
      ]);
    });
  });

  describe('GetRecordCollaboratorsQuery', () => {
    let tableId: string;
    let assigneesFieldId: string;
    const bob = {
      id: 'usrV2E2eCollaboratorBob',
      title: 'Bob Collaborator',
      email: 'bob+v2-query-e2e@example.com',
    };
    const carol = {
      id: 'usrV2E2eCollaboratorCarol',
      title: 'Carol Collaborator',
      email: 'carol+v2-query-e2e@example.com',
    };

    beforeAll(async () => {
      for (const user of [bob, carol]) {
        await sql`
          insert into users (id, name, email)
          values (${user.id}, ${user.title}, ${user.email})
          on conflict (id) do nothing
        `.execute(ctx.testContainer.db);
        await sql`
          insert into collaborator (id, resource_type, resource_id, principal_id, principal_type)
          values (${`col${user.id}`}, 'base', ${ctx.baseId}, ${user.id}, 'user')
          on conflict (id) do nothing
        `.execute(ctx.testContainer.db);
      }

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Collaborators Query',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'user', name: 'Assignees', options: { isMultiple: true } },
        ],
        views: [{ type: 'grid', name: 'Grid' }],
      });
      tableId = table.id;
      const nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
      assigneesFieldId = table.fields.find((field) => field.name === 'Assignees')?.id ?? '';
      if (!nameFieldId || !assigneesFieldId) {
        throw new Error('Record collaborators fixture is incomplete');
      }
      const alice = { id: TEST_USER.id, title: TEST_USER.name };
      await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 'First',
            [assigneesFieldId]: [alice, bob],
          },
        },
        {
          fields: {
            [nameFieldId]: 'Second',
            [assigneesFieldId]: [bob, carol],
          },
        },
        { fields: { [nameFieldId]: 'Empty' } },
      ]);
    });

    afterAll(async () => {
      if (tableId) await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    });

    const execute = async (input: {
      search?: string;
      take?: number;
      skip?: number;
    }): Promise<GetRecordCollaboratorsResult> => {
      const query = GetRecordCollaboratorsQuery.create({
        tableId,
        fieldId: assigneesFieldId,
        ...input,
      })._unsafeUnwrap();
      const result = await queryBus.execute<
        GetRecordCollaboratorsQuery,
        GetRecordCollaboratorsResult
      >({ actorId, windowId: 'record-collaborators-e2e' }, query);
      if (result.isErr()) throw new Error(result.error.message);
      return result.value;
    };

    it('returns distinct users from stored cells and supports name/email search', async () => {
      const all = await execute({});
      expect(
        all.collaborators
          .map(({ userId, userName, email }) => ({ userId, userName, email }))
          .sort((left, right) => left.userId.localeCompare(right.userId))
      ).toEqual(
        [
          { userId: TEST_USER.id, userName: TEST_USER.name, email: TEST_USER.email },
          { userId: bob.id, userName: bob.title, email: bob.email },
          { userId: carol.id, userName: carol.title, email: carol.email },
        ].sort((left, right) => left.userId.localeCompare(right.userId))
      );

      expect((await execute({ search: 'BOB COLLABORATOR' })).collaborators).toEqual([
        expect.objectContaining({ userId: bob.id, userName: bob.title, email: bob.email }),
      ]);
      expect((await execute({ search: 'carol+v2-query' })).collaborators).toEqual([
        expect.objectContaining({ userId: carol.id, userName: carol.title, email: carol.email }),
      ]);
    });
  });

  describe('GetCalendarDailyCollectionQuery', () => {
    let tableId: string;
    let viewId: string;
    let statusFieldId: string;
    let startFieldId: string;
    let endFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Calendar Daily Collection Query',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Status' },
          {
            type: 'date',
            name: 'Start',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          },
          {
            type: 'date',
            name: 'End',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          },
        ],
        views: [{ type: 'grid', name: 'Open events' }],
      });
      tableId = table.id;
      const nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
      statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
      startFieldId = table.fields.find((field) => field.name === 'Start')?.id ?? '';
      endFieldId = table.fields.find((field) => field.name === 'End')?.id ?? '';
      viewId = table.views[0]?.id ?? '';
      if (!nameFieldId || !statusFieldId || !startFieldId || !endFieldId || !viewId) {
        throw new Error('Calendar daily collection fixture is incomplete');
      }

      await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 'One day',
            [statusFieldId]: 'open',
            [startFieldId]: '2026-01-02T08:00:00.000Z',
            [endFieldId]: '2026-01-02T12:00:00.000Z',
          },
        },
        {
          fields: {
            [nameFieldId]: 'Multi day',
            [statusFieldId]: 'open',
            [startFieldId]: '2026-01-03T08:00:00.000Z',
            [endFieldId]: '2026-01-05T12:00:00.000Z',
          },
        },
        {
          fields: {
            [nameFieldId]: 'Filtered out',
            [statusFieldId]: 'closed',
            [startFieldId]: '2026-01-04T08:00:00.000Z',
            [endFieldId]: '2026-01-04T12:00:00.000Z',
          },
        },
      ]);
    });

    afterAll(async () => {
      if (tableId) await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    });

    it('collects records across their date span and applies the request filter', async () => {
      const query = GetCalendarDailyCollectionQuery.create({
        tableId,
        viewId,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-06T00:00:00.000Z',
        startDateFieldId: startFieldId,
        endDateFieldId: endFieldId,
        filter: { fieldId: statusFieldId, operator: 'is', value: 'open' },
      });
      expect(query.isOk(), query.isErr() ? query.error.message : undefined).toBe(true);
      if (query.isErr()) return;
      const result = await queryBus.execute<
        GetCalendarDailyCollectionQuery,
        GetCalendarDailyCollectionResult
      >({ actorId, windowId: 'calendar-daily-collection-e2e' }, query.value);

      expect(result.isOk(), result.isErr() ? result.error.message : undefined).toBe(true);
      if (result.isErr()) return;
      expect(result.value.countMap).toEqual({
        '2026-01-02': 1,
        '2026-01-03': 1,
        '2026-01-04': 1,
        '2026-01-05': 1,
      });
      expect(result.value.records).toHaveLength(2);
    });
  });

  describe('GetViewSelectionCopyQuery', () => {
    let tableId: string;
    let viewId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Selection Copy Query',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Amount' },
        ],
        views: [{ type: 'grid', name: 'Grid' }],
      });
      tableId = table.id;
      viewId = table.views[0]?.id ?? '';
      const nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
      const amountFieldId = table.fields.find((field) => field.name === 'Amount')?.id ?? '';
      if (!viewId || !nameFieldId || !amountFieldId) {
        throw new Error('Selection copy fixture is incomplete');
      }
      await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'Alpha', [amountFieldId]: 12 } },
        { fields: { [nameFieldId]: 'Beta', [amountFieldId]: 23 } },
        { fields: { [nameFieldId]: 'Gamma', [amountFieldId]: 34 } },
      ]);
    });

    afterAll(async () => {
      if (tableId) await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    });

    it('formats bounded cells and enforces the copy-cell limit against stored rows', async () => {
      const input = {
        tableId,
        viewId,
        sharedView: false,
        ranges: [
          [0, 0],
          [1, 1],
        ],
      } as const;
      const query = GetViewSelectionCopyQuery.create(input, {
        maxCopyCells: 10,
      })._unsafeUnwrap();
      const result = await queryBus.execute<GetViewSelectionCopyQuery, GetViewSelectionCopyResult>(
        { actorId, windowId: 'selection-copy-e2e' },
        query
      );

      expect(result.isOk(), result.isErr() ? result.error.message : undefined).toBe(true);
      if (result.isErr()) return;
      expect(result.value.content).toBe('Alpha\t12.00\nBeta\t23.00');
      expect(result.value.fields.map((field) => field.name().toString())).toEqual([
        'Name',
        'Amount',
      ]);

      const overLimitQuery = GetViewSelectionCopyQuery.create(input, {
        maxCopyCells: 3,
      })._unsafeUnwrap();
      const overLimit = await queryBus.execute<
        GetViewSelectionCopyQuery,
        GetViewSelectionCopyResult
      >({ actorId, windowId: 'selection-copy-limit-e2e' }, overLimitQuery);
      expect(overLimit.isErr()).toBe(true);
      if (overLimit.isErr()) {
        expect(overLimit.error.code).toBe('view_selection_copy.exceed_max_copy_cells');
      }
    });
  });

  describe('GetRecordStatusQuery', () => {
    let tableId: string;
    let statusFieldId: string;
    let visibleRecordId: string;
    let filteredRecordId: string;
    let deletedRecordId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Status Query',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Status' },
        ],
        views: [{ type: 'grid', name: 'Grid' }],
      });
      tableId = table.id;
      const nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
      statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
      if (!nameFieldId || !statusFieldId) throw new Error('Record status fixture is incomplete');
      const records = await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'Visible', [statusFieldId]: 'open' } },
        { fields: { [nameFieldId]: 'Filtered', [statusFieldId]: 'closed' } },
        { fields: { [nameFieldId]: 'Deleted', [statusFieldId]: 'open' } },
      ]);
      visibleRecordId = records[0]?.id ?? '';
      filteredRecordId = records[1]?.id ?? '';
      deletedRecordId = records[2]?.id ?? '';
      await ctx.deleteRecords(tableId, [deletedRecordId]);
    });

    afterAll(async () => {
      if (tableId) await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    });

    const getStatus = async (recordId: string): Promise<GetRecordStatusResult> => {
      const query = GetRecordStatusQuery.create({
        tableId,
        recordId,
        filter: { fieldId: statusFieldId, operator: 'is', value: 'open' },
      })._unsafeUnwrap();
      const result = await queryBus.execute<GetRecordStatusQuery, GetRecordStatusResult>(
        { actorId, windowId: 'record-status-e2e' },
        query
      );
      if (result.isErr()) throw new Error(result.error.message);
      return result.value;
    };

    it('distinguishes visible, filtered-out, and deleted records', async () => {
      expect(await getStatus(visibleRecordId)).toMatchObject({
        isDeleted: false,
        isVisible: true,
      });
      expect(await getStatus(filteredRecordId)).toMatchObject({
        isDeleted: false,
        isVisible: false,
      });
      expect(await getStatus(deletedRecordId)).toMatchObject({
        isDeleted: true,
        isVisible: false,
      });
    });
  });
});
