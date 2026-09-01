import {
  AggregateTableRecordsQuery,
  AggregateTableRecordsResult,
  CountTableRecordsQuery,
  CountTableRecordsResult,
  FieldId,
  GetCalendarDailyCollectionQuery,
  GetCalendarDailyCollectionResult,
  ListTableRecordsQuery,
  ListTableRecordsResult,
  RecordId,
  v2CoreTokens,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { vi } from 'vitest';
import { string2Hash } from '../../../utils';
import { AggregationOpenApiV2Service } from './aggregation-open-api-v2.service';

describe('AggregationOpenApiV2Service', () => {
  const tableId = `tbl${'t'.repeat(16)}`;
  const viewId = `viw${'v'.repeat(16)}`;
  const fieldId = `fld${'f'.repeat(16)}`;
  const primaryFieldId = FieldId.create(fieldId)._unsafeUnwrap();

  const createFixture = (options?: {
    total?: number;
    aggregateValues?: Parameters<typeof AggregateTableRecordsResult.create>[0];
    aggregateGroups?: Parameters<typeof AggregateTableRecordsResult.create>[1];
    pluginScope?: Record<string, unknown>;
    searchMatches?: NonNullable<Parameters<typeof ListTableRecordsResult.create>[5]>;
    calendarEntries?: Parameters<typeof GetCalendarDailyCollectionResult.create>[0];
    calendarRecords?: Parameters<typeof GetCalendarDailyCollectionResult.create>[1];
  }) => {
    const queries: unknown[] = [];
    const queryBus = {
      execute: vi.fn(async (_context: unknown, query: unknown) => {
        queries.push(query);
        if (query instanceof ListTableRecordsQuery) {
          return ok(
            ListTableRecordsResult.create(
              [],
              options?.total ?? 0,
              0,
              1,
              undefined,
              options?.searchMatches
            )
          );
        }
        if (query instanceof CountTableRecordsQuery) {
          return ok(CountTableRecordsResult.create(options?.total ?? 0));
        }
        if (query instanceof AggregateTableRecordsQuery) {
          return ok(
            AggregateTableRecordsResult.create(
              options?.aggregateValues ?? [],
              options?.aggregateGroups ?? []
            )
          );
        }
        if (query instanceof GetCalendarDailyCollectionQuery) {
          return ok(
            GetCalendarDailyCollectionResult.create(
              options?.calendarEntries ?? [],
              options?.calendarRecords ?? []
            )
          );
        }
        throw new Error('Unexpected query');
      }),
    };
    const attachmentDecorator = {
      decorateAttachmentValue: vi.fn(async (value: unknown) => ok(value)),
    };
    const pluginRunner = {
      prepare: vi.fn(async () =>
        ok({
          guard: vi.fn(async () => ok(undefined)),
          getScope: vi.fn(() => ok(options?.pluginScope)),
        })
      ),
    };
    const tableRepository = {
      findOne: vi.fn(async () => ok({ id: () => ({ toString: () => tableId }) })),
    };
    const hasPluginRunner = options?.pluginScope !== undefined;
    const container = {
      isRegistered: vi.fn((token: unknown) =>
        token === v2CoreTokens.recordQueryPluginRunner ? hasPluginRunner : false
      ),
      resolve: vi.fn((token: unknown) => {
        if (token === v2CoreTokens.recordQueryPluginRunner) return pluginRunner;
        if (token === v2CoreTokens.tableRepository) return tableRepository;
        if (token === v2CoreTokens.attachmentValueDecoratorService) return attachmentDecorator;
        return queryBus;
      }),
    };
    const getContainerForTable = vi.fn().mockResolvedValue(container);
    const createContext = vi.fn().mockResolvedValue({
      actorId: { toString: () => `usr${'u'.repeat(16)}` },
    });
    const service = new AggregationOpenApiV2Service(
      { getContainerForTable } as never,
      { createContext } as never,
      { maxGroupPoints: 5_000 } as never
    );

    return { service, queries, queryBus, getContainerForTable, pluginRunner };
  };

  it('falls back for aggregation without a viewId', async () => {
    const fixture = createFixture();

    await expect(fixture.service.tryGetAggregation(tableId, {})).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('falls back for aggregation with ignoreViewQuery', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.tryGetAggregation(tableId, { viewId, ignoreViewQuery: true })
    ).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('falls back for aggregation with link-cell filters', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.tryGetAggregation(tableId, {
        viewId,
        filterLinkCellCandidate: [fieldId, `rec${'r'.repeat(16)}`],
      })
    ).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('narrows row-count search to an explicit projection', async () => {
    const fixture = createFixture({ total: 3 });

    await expect(
      fixture.service.tryGetRowCount(tableId, {
        projection: [fieldId],
        search: ['alpha', fieldId, true],
      })
    ).resolves.toEqual({ rowCount: 3 });

    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );
    expect(countQuery?.projection).toEqual([fieldId]);
    expect(countQuery?.searchFieldScope).toBe('projection');
    expect(countQuery?.search).toEqual(['alpha', fieldId, true]);
  });

  it('threads a restricted record query plugin scope into row counts', async () => {
    const pluginScope = { recordSpec: {} };
    const fixture = createFixture({ total: 7, pluginScope });

    await expect(fixture.service.tryGetRowCount(tableId, { viewId })).resolves.toEqual({
      rowCount: 7,
    });
    expect(fixture.pluginRunner.prepare).toHaveBeenCalled();
    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );
    expect(countQuery?.queryScope).toBe(pluginScope);
  });

  it('falls back for group points without groupBy', async () => {
    const fixture = createFixture();

    await expect(fixture.service.tryGetGroupPoints(tableId, { viewId })).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('serves row counts through the v2 count query', async () => {
    const fixture = createFixture({ total: 42 });

    await expect(fixture.service.tryGetRowCount(tableId, { viewId })).resolves.toEqual({
      rowCount: 42,
    });
    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );
    expect(countQuery?.viewId?.toString()).toBe(viewId);
  });

  it('passes link-cell selection into the v2 count query', async () => {
    const fixture = createFixture({ total: 1 });
    const hostRecordId = `rec${'r'.repeat(16)}`;

    await expect(
      fixture.service.tryGetRowCount(tableId, {
        filterLinkCellSelected: [fieldId, hostRecordId],
        selectedRecordIds: [`rec${'x'.repeat(16)}`],
      })
    ).resolves.toEqual({ rowCount: 1 });

    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );
    expect(countQuery?.filterLinkCellSelected).toEqual([fieldId, hostRecordId]);
    expect(countQuery?.selectedRecordIds).toEqual([`rec${'x'.repeat(16)}`]);
  });

  it('maps aggregation totals and requested fields through the v2 aggregate query', async () => {
    const fixture = createFixture({
      aggregateValues: [
        { fieldId: primaryFieldId, statisticFunc: 'count', value: 3 },
        { fieldId: primaryFieldId, statisticFunc: 'unique', value: 2 },
      ],
    });

    const result = await fixture.service.tryGetAggregation(tableId, {
      viewId,
      field: { count: [fieldId], unique: [fieldId] },
    });

    expect(result).toEqual({
      aggregations: [
        { fieldId, total: { value: 3, aggFunc: 'count' } },
        { fieldId, total: { value: 2, aggFunc: 'unique' } },
      ],
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );
    expect(aggregateQuery?.viewId.toString()).toBe(viewId);
    expect(aggregateQuery?.fields).toEqual([
      { fieldId, statisticFunc: 'count' },
      { fieldId, statisticFunc: 'unique' },
    ]);
  });

  it('falls back for selection aggregation with selectedRecordIds', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.tryGetSelectionAggregation(tableId, {
        viewId,
        skip: 0,
        take: 5,
        selectedRecordIds: [`rec${'r'.repeat(16)}`],
      })
    ).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('falls back for selection aggregation when the record query plugin scope is restricted', async () => {
    const fixture = createFixture({ pluginScope: { fieldMasks: [{}] } });

    await expect(
      fixture.service.tryGetSelectionAggregation(tableId, {
        viewId,
        skip: 0,
        take: 5,
        field: { sum: [fieldId] },
      })
    ).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).toHaveBeenCalledWith(tableId);
    expect(fixture.pluginRunner.prepare).toHaveBeenCalled();
  });

  it('maps selection aggregation through a paginated v2 aggregate query', async () => {
    const fixture = createFixture({
      aggregateValues: [{ fieldId: primaryFieldId, statisticFunc: 'sum', value: 50 }],
    });

    const result = await fixture.service.tryGetSelectionAggregation(tableId, {
      viewId,
      skip: 1,
      take: 2,
      field: { sum: [fieldId] },
      orderBy: [{ fieldId, order: 'asc' }],
      groupBy: [{ fieldId, order: 'desc' }],
    });

    expect(result).toEqual({
      aggregations: [{ fieldId, total: { value: 50, aggFunc: 'sum' } }],
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );
    expect(aggregateQuery?.skip).toBe(1);
    expect(aggregateQuery?.take).toBe(2);
    expect(aggregateQuery?.groupBy).toEqual([{ fieldId, order: 'desc' }]);
    expect(aggregateQuery?.orderBy).toEqual([{ fieldId, order: 'asc' }]);
  });

  it('passes collapsed groups through the v2 aggregate query', async () => {
    const fixture = createFixture({
      aggregateValues: [{ fieldId: primaryFieldId, statisticFunc: 'sum', value: 300 }],
    });

    const result = await fixture.service.tryGetSelectionAggregation(tableId, {
      viewId,
      skip: 0,
      take: 5,
      groupBy: [{ fieldId, order: 'asc' }],
      collapsedGroupIds: ['group-a'],
      field: { sum: [fieldId] },
    });

    expect(result).toEqual({
      aggregations: [{ fieldId, total: { value: 300, aggFunc: 'sum' } }],
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );
    expect(aggregateQuery?.collapsedGroupIds).toEqual(['group-a']);
    expect(aggregateQuery?.groupBy).toEqual([{ fieldId, order: 'asc' }]);
  });

  it('passes ignoreViewQuery through the v2 aggregate query', async () => {
    const fixture = createFixture({
      aggregateValues: [{ fieldId: primaryFieldId, statisticFunc: 'sum', value: 100 }],
    });

    const result = await fixture.service.tryGetSelectionAggregation(tableId, {
      viewId,
      ignoreViewQuery: true,
      skip: 0,
      take: 5,
      field: { sum: [fieldId] },
    });

    expect(result).toEqual({
      aggregations: [{ fieldId, total: { value: 100, aggFunc: 'sum' } }],
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );
    expect(aggregateQuery?.ignoreViewQuery).toBe(true);
  });

  it('maps grouped counts to group points', async () => {
    const firstGroupId = String(string2Hash(`${fieldId}_A`));
    const fixture = createFixture({
      aggregateValues: [
        { fieldId: primaryFieldId, statisticFunc: 'count', value: 3 },
        { fieldId: primaryFieldId, statisticFunc: 'count', value: 2, groupValues: ['A'] },
        { fieldId: primaryFieldId, statisticFunc: 'count', value: 1, groupValues: ['B'] },
      ],
      aggregateGroups: [{ fieldId: primaryFieldId, fieldType: 'singleLineText', order: 'asc' }],
    });

    const result = await fixture.service.tryGetGroupPoints(tableId, {
      viewId,
      groupBy: [{ fieldId, order: 'asc' as never }],
    });

    expect(result?.[0]).toMatchObject({ id: firstGroupId, depth: 0, value: 'A' });
    expect(result).toHaveLength(4);
  });

  it('requires a search tuple before resolving persistence for search count', async () => {
    const fixture = createFixture();

    await expect(fixture.service.tryGetSearchCount(tableId, {})).rejects.toMatchObject({
      status: 400,
    });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('serves search counts through the v2 count query and keeps the view filter', async () => {
    const fixture = createFixture({ total: 1 });

    await expect(
      fixture.service.tryGetSearchCount(tableId, {
        viewId,
        search: ['Cup', fieldId, false],
      })
    ).resolves.toEqual({ count: 1 });

    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );
    expect(countQuery?.viewId?.toString()).toBe(viewId);
    expect(countQuery?.search).toEqual(['Cup', fieldId, true]);
  });

  it('threads a restricted plugin scope for search counts instead of falling back', async () => {
    const fixture = createFixture({ total: 4, pluginScope: { recordSpec: {} } });

    await expect(
      fixture.service.tryGetSearchCount(tableId, { search: ['Cup', fieldId, true] })
    ).resolves.toEqual({ count: 4 });
    expect(fixture.pluginRunner.prepare).toHaveBeenCalled();
    expect(fixture.queryBus.execute).toHaveBeenCalled();
  });

  it('rejects search-index pages larger than 1000 before resolving persistence', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.tryGetSearchIndex(tableId, {
        take: 1001,
        search: ['Cup', fieldId, true],
      })
    ).rejects.toMatchObject({ status: 400, message: 'The maximum search index result is 1000' });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('maps search-index hits and uses matched indexes when hide-not-match is on', async () => {
    const recordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
    const fixture = createFixture({
      searchMatches: [{ index: 1, fieldId: primaryFieldId, recordId }],
    });

    const result = await fixture.service.tryGetSearchIndex(tableId, {
      viewId,
      take: 10,
      search: ['Cup', fieldId, true],
    });
    const listQuery = fixture.queries.find(
      (query): query is ListTableRecordsQuery => query instanceof ListTableRecordsQuery
    );

    expect(result).toEqual([{ index: 1, fieldId, recordId: recordId.toString() }]);
    expect(listQuery?.includeSearchFieldMatches).toBe(true);
    expect(listQuery?.searchIndexMode).toBe('matched');
    expect(listQuery?.search).toEqual(['Cup', fieldId, true]);
  });

  it('uses view-row indexes when hide-not-match is off', async () => {
    const fixture = createFixture();

    await fixture.service.tryGetSearchIndex(tableId, {
      viewId,
      take: 10,
      search: ['Cup', fieldId, false],
    });
    const listQuery = fixture.queries.find(
      (query): query is ListTableRecordsQuery => query instanceof ListTableRecordsQuery
    );
    expect(listQuery?.searchIndexMode).toBe('view');
    expect(listQuery?.search).toEqual(['Cup', fieldId, true]);
  });

  it('treats search-index take 0 as the 1000-row cap', async () => {
    const fixture = createFixture();

    await fixture.service.tryGetSearchIndex(tableId, {
      viewId,
      take: 0,
      search: ['Cup', fieldId, false],
    });
    const listQuery = fixture.queries.find(
      (query): query is ListTableRecordsQuery => query instanceof ListTableRecordsQuery
    );
    expect(listQuery?.pagination.limit().toNumber()).toBe(1000);
  });

  it('returns null when search-index has no matching cells', async () => {
    const fixture = createFixture({ searchMatches: [] });

    await expect(
      fixture.service.tryGetSearchIndex(tableId, {
        take: 10,
        search: ['missing', fieldId, true],
      })
    ).resolves.toBeNull();
  });

  it('narrows search-count to an explicit projection', async () => {
    const fixture = createFixture({ total: 2 });

    await expect(
      fixture.service.tryGetSearchCount(tableId, { search: ['Cup', '', true] }, [fieldId])
    ).resolves.toEqual({ count: 2 });

    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );
    expect(countQuery?.projection).toEqual([fieldId]);
    expect(countQuery?.searchFieldScope).toBe('projection');
  });

  it('falls back for calendar daily collection without a viewId', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.tryGetCalendarDailyCollection(tableId, {
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        startDateFieldId: fieldId,
        endDateFieldId: fieldId,
      })
    ).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('falls back for calendar daily collection with ignoreViewQuery', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.tryGetCalendarDailyCollection(tableId, {
        viewId,
        ignoreViewQuery: true,
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        startDateFieldId: fieldId,
        endDateFieldId: fieldId,
      })
    ).resolves.toBeUndefined();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('maps calendar daily collection countMap and records through the v2 query', async () => {
    const recordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
    const fixture = createFixture({
      calendarEntries: [{ date: '2025-01-01', count: 2, recordIds: [recordId] }],
      calendarRecords: [{ id: recordId.toString(), fields: { [fieldId]: 'A' }, version: 1 }],
    });

    await expect(
      fixture.service.tryGetCalendarDailyCollection(tableId, {
        viewId,
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        startDateFieldId: fieldId,
        endDateFieldId: fieldId,
      })
    ).resolves.toEqual({
      countMap: { '2025-01-01': 2 },
      records: [{ id: recordId.toString(), fields: { [fieldId]: 'A' } }],
    });

    const calendarQuery = fixture.queries.find(
      (query): query is GetCalendarDailyCollectionQuery =>
        query instanceof GetCalendarDailyCollectionQuery
    );
    expect(calendarQuery?.viewId.toString()).toBe(viewId);
    expect(calendarQuery?.startDateFieldId).toBe(fieldId);
    expect(calendarQuery?.endDateFieldId).toBe(fieldId);
  });
});
