import { HttpException } from '@nestjs/common';
import { FieldType, SortFunc, ViewType } from '@teable/core';
import { ShareViewLinkRecordsType } from '@teable/openapi';
import {
  AggregateTableRecordsQuery,
  AggregateTableRecordsResult,
  CountTableRecordsQuery,
  CountTableRecordsResult,
  FieldId,
  GetCalendarDailyCollectionQuery,
  GetCalendarDailyCollectionResult,
  GetViewLinkRecordsQuery,
  GetViewLinkRecordsResult,
  GetViewCollaboratorsQuery,
  GetViewCollaboratorsResult,
  GetViewSelectionCopyQuery,
  GetViewSelectionCopyResult,
  ListFieldsQuery,
  ListFieldsResult,
  ListTableRecordsQuery,
  ListTableRecordsResult,
  RecordId,
  v2CoreTokens,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { vi } from 'vitest';
import { string2Hash } from '../../utils';
import type { IShareViewInfo } from './share-auth.service';
import { SharedViewRecordQueryV2Service } from './shared-view-record-query-v2.service';

describe('SharedViewRecordQueryV2Service', () => {
  const tableId = `tbl${'t'.repeat(16)}`;
  const viewId = `viw${'v'.repeat(16)}`;
  const candidateViewId = `viw${'c'.repeat(16)}`;
  const fieldId = `fld${'f'.repeat(16)}`;
  const startFieldId = `fld${'s'.repeat(16)}`;
  const endFieldId = `fld${'e'.repeat(16)}`;
  const primaryFieldId = FieldId.create(fieldId)._unsafeUnwrap();

  const createFixture = (
    total = 3,
    searchMatches?: Parameters<typeof ListTableRecordsResult.create>[5],
    aggregateValues: Parameters<typeof AggregateTableRecordsResult.create>[0] = [],
    aggregateGroups: Parameters<typeof AggregateTableRecordsResult.create>[1] = [],
    calendarResult: GetCalendarDailyCollectionResult = GetCalendarDailyCollectionResult.create(
      [],
      []
    ),
    linkResult: GetViewLinkRecordsResult = GetViewLinkRecordsResult.create([]),
    collaboratorsResult: GetViewCollaboratorsResult = GetViewCollaboratorsResult.create([]),
    copyResult?: GetViewSelectionCopyResult
  ) => {
    const queries: unknown[] = [];
    const mappedField = {
      accept: vi.fn().mockReturnValue(
        ok({
          id: fieldId,
          name: 'Name',
          type: FieldType.SingleLineText,
          isPrimary: true,
        })
      ),
    };
    const queryBus = {
      execute: vi.fn(async (_context, query: unknown) => {
        queries.push(query);
        if (query instanceof ListFieldsQuery) {
          return ok(ListFieldsResult.create([mappedField as never], primaryFieldId));
        }
        if (query instanceof ListTableRecordsQuery) {
          return ok(ListTableRecordsResult.create([], total, 0, 1, undefined, searchMatches));
        }
        if (query instanceof CountTableRecordsQuery) {
          return ok(CountTableRecordsResult.create(total));
        }
        if (query instanceof AggregateTableRecordsQuery) {
          return ok(AggregateTableRecordsResult.create(aggregateValues, aggregateGroups));
        }
        if (query instanceof GetCalendarDailyCollectionQuery) {
          return ok(calendarResult);
        }
        if (query instanceof GetViewLinkRecordsQuery) {
          return ok(linkResult);
        }
        if (query instanceof GetViewCollaboratorsQuery) {
          return ok(collaboratorsResult);
        }
        if (query instanceof GetViewSelectionCopyQuery) {
          return ok(
            copyResult ??
              GetViewSelectionCopyResult.create('Alpha', [mappedField as never], primaryFieldId)
          );
        }
        throw new Error('Unexpected query');
      }),
    };
    const attachmentDecorator = {
      decorateAttachmentValue: vi.fn(async (value: unknown) => ok(value)),
    };
    const getContainerForTable = vi.fn().mockResolvedValue({
      resolve: vi.fn((token) =>
        token === v2CoreTokens.attachmentValueDecoratorService ? attachmentDecorator : queryBus
      ),
    });
    const createContext = vi.fn().mockResolvedValue({
      actorId: { toString: () => `usr${'u'.repeat(16)}` },
    });
    const cacheGet = vi.fn(async (): Promise<Record<string, unknown> | undefined> => undefined);
    const resolveForRecordSearch = vi.fn().mockResolvedValue(undefined);
    const service = new SharedViewRecordQueryV2Service(
      { getContainerForTable } as never,
      { createContext } as never,
      { maxGroupPoints: 5_000, maxCopyCells: 50_000 } as never,
      { get: cacheGet } as never,
      { resolveForRecordSearch } as never
    );

    return {
      service,
      queries,
      queryBus,
      attachmentDecorator,
      getContainerForTable,
      createContext,
      cacheGet,
      resolveForRecordSearch,
    };
  };

  const shareInfo = {
    shareId: `shr${'s'.repeat(16)}`,
    tableId,
    shareMeta: { includeRecords: true },
    view: {
      id: viewId,
      name: 'Grid',
      type: ViewType.Grid,
      columnMeta: {},
    },
  } as IShareViewInfo;

  it.each(['count', 'aggregation', 'groups'] as const)(
    'resolves the trusted runtime search path for %s',
    async (kind) => {
      const fixture = createFixture();
      const accessPath = {
        kind: 'generated_text',
        generatedColumnName: '__search_document',
        provider: 'pg_trgm',
        searchScope: 'all_fields',
        coveredFieldIds: [primaryFieldId],
      };
      fixture.resolveForRecordSearch.mockResolvedValue(accessPath);
      const search: [string, string, boolean] = ['order', '', true];
      if (kind === 'count') {
        await fixture.service.getRowCount(shareInfo, { search });
      } else if (kind === 'aggregation') {
        await fixture.service.getAggregations(shareInfo, { search });
      } else {
        await fixture.service.getGroupPoints(shareInfo, {
          search,
          groupBy: [{ fieldId, order: SortFunc.Asc }],
        });
      }
      expect(fixture.resolveForRecordSearch).toHaveBeenCalledWith({
        container: await fixture.getContainerForTable.mock.results[0].value,
        tableId,
        search,
      });
      const query = fixture.queries.find(
        (item) =>
          item instanceof CountTableRecordsQuery || item instanceof AggregateTableRecordsQuery
      );
      expect(query).toHaveProperty('recordSearchAccessPath', accessPath);
    }
  );

  it('returns empty aggregation before resolving v2 dependencies when records are disabled', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getAggregations({
      ...shareInfo,
      shareMeta: { includeRecords: false },
    });

    expect(result).toEqual({ aggregations: [] });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('returns an empty calendar collection before resolving v2 dependencies when records are disabled', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getCalendarDailyCollection(
      { ...shareInfo, shareMeta: { includeRecords: false } },
      {
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        startDateFieldId: startFieldId,
        endDateFieldId: endFieldId,
      }
    );

    expect(result).toEqual({ countMap: {}, records: [] });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('binds calendar collection to the authorized View, normalizes filters, and maps records', async () => {
    const recordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
    const fixture = createFixture(
      0,
      undefined,
      [],
      [],
      GetCalendarDailyCollectionResult.create(
        [{ date: '2025-01-02', count: 1, recordIds: [recordId] }],
        [{ id: recordId.toString(), fields: { [fieldId]: 'Alpha' }, version: 3 }]
      )
    );

    const result = await fixture.service.getCalendarDailyCollection(
      {
        ...shareInfo,
        shareMeta: { includeRecords: true, includeHiddenField: true },
      },
      {
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        startDateFieldId: startFieldId,
        endDateFieldId: endFieldId,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId, operator: 'is', value: 'Alpha' }],
        },
        search: ['Alpha', fieldId, true],
      }
    );
    const calendarQuery = fixture.queries.find(
      (query): query is GetCalendarDailyCollectionQuery =>
        query instanceof GetCalendarDailyCollectionQuery
    );

    expect(fixture.queries[0]).toBeInstanceOf(ListFieldsQuery);
    expect(calendarQuery?.viewId.toString()).toBe(viewId);
    expect(calendarQuery?.filter).toEqual({
      conjunction: 'and',
      items: [{ fieldId, operator: 'is', value: 'Alpha' }],
    });
    expect(calendarQuery?.search).toEqual(['Alpha', fieldId, true]);
    expect(calendarQuery?.includeHiddenFields).toBe(true);
    expect(result).toEqual({
      countMap: Object.fromEntries([['2025-01-02', 1]]),
      records: [{ id: recordId.toString(), fields: { [fieldId]: 'Alpha' } }],
    });
  });

  it('rejects a missing authorized View before opening a v2 container', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.getCalendarDailyCollection(
        { ...shareInfo, view: undefined },
        {
          startDate: '2025-01-01',
          endDate: '2025-01-03',
          startDateFieldId: startFieldId,
          endDateFieldId: endFieldId,
        }
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('binds Link Records to the authorized aggregate and preserves pagination/search inputs', async () => {
    const linkFieldId = `fld${'k'.repeat(16)}`;
    const firstRecordId = `rec${'a'.repeat(16)}`;
    const secondRecordId = `rec${'b'.repeat(16)}`;
    const fixture = createFixture(
      2,
      undefined,
      [],
      [],
      GetCalendarDailyCollectionResult.create([], []),
      GetViewLinkRecordsResult.create([
        { id: firstRecordId, title: 'Alpha' },
        { id: secondRecordId, title: '42' },
      ])
    );

    const result = await fixture.service.getLinkRecords(
      {
        ...shareInfo,
        shareMeta: { includeRecords: false, includeHiddenField: true },
      },
      {
        fieldId: linkFieldId,
        type: ShareViewLinkRecordsType.Candidate,
        search: 'Al',
        take: 20,
        skip: 5,
      }
    );
    const planQuery = fixture.queries.find(
      (item): item is GetViewLinkRecordsQuery => item instanceof GetViewLinkRecordsQuery
    );

    expect(planQuery).toMatchObject({
      requestType: 'candidate',
      includeHiddenFields: true,
      search: 'Al',
    });
    expect(planQuery?.tableId.toString()).toBe(tableId);
    expect(planQuery?.viewId.toString()).toBe(viewId);
    expect(planQuery?.fieldId.toString()).toBe(linkFieldId);
    expect(planQuery?.pagination.limit().toNumber()).toBe(20);
    expect(planQuery?.pagination.offset().toNumber()).toBe(5);
    expect(result).toEqual([
      { id: firstRecordId, title: 'Alpha' },
      { id: secondRecordId, title: '42' },
    ]);
  });

  it('defaults Link Records pagination without consulting includeRecords', async () => {
    const recordId = `rec${'a'.repeat(16)}`;
    const fixture = createFixture(
      1,
      undefined,
      [],
      [],
      GetCalendarDailyCollectionResult.create([], []),
      GetViewLinkRecordsResult.create([{ id: recordId }])
    );

    const result = await fixture.service.getLinkRecords(
      { ...shareInfo, shareMeta: { includeRecords: false } },
      {
        fieldId,
        skip: 5,
      }
    );
    const planQuery = fixture.queries.find(
      (item): item is GetViewLinkRecordsQuery => item instanceof GetViewLinkRecordsQuery
    );

    expect(planQuery?.pagination.limit().toNumber()).toBe(100);
    expect(planQuery?.pagination.offset().toNumber()).toBe(5);
    expect(result).toEqual([{ id: recordId }]);
  });

  it('rejects Link Records without an authorized View before opening a v2 container', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.getLinkRecords(
        { ...shareInfo, view: undefined },
        { fieldId, take: 10, skip: 0 }
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('binds collaborators to the authorized aggregate and preserves privacy inputs', async () => {
    const userFieldId = `fld${'u'.repeat(16)}`;
    const fixture = createFixture(
      0,
      undefined,
      [],
      [],
      GetCalendarDailyCollectionResult.create([], []),
      GetViewLinkRecordsResult.create([]),
      GetViewCollaboratorsResult.create([
        { userId: 'usr-alice', userName: 'Alice', avatar: 'alice.png' },
      ])
    );

    const result = await fixture.service.getCollaborators(
      {
        ...shareInfo,
        shareMeta: { includeHiddenField: true },
      },
      {
        fieldId: userFieldId,
        search: 'Ali',
        take: 20,
        skip: 5,
      },
      true
    );
    const collaboratorsQuery = fixture.queries.find(
      (item): item is GetViewCollaboratorsQuery => item instanceof GetViewCollaboratorsQuery
    );

    expect(collaboratorsQuery?.tableId.toString()).toBe(tableId);
    expect(collaboratorsQuery?.viewId?.toString()).toBe(viewId);
    expect(collaboratorsQuery?.fieldId?.toString()).toBe(userFieldId);
    expect(collaboratorsQuery).toMatchObject({
      includeHiddenFields: true,
      canReadAllCollaborators: true,
      search: 'Ali',
    });
    expect(collaboratorsQuery?.pagination.limit().toNumber()).toBe(20);
    expect(collaboratorsQuery?.pagination.offset().toNumber()).toBe(5);
    expect(result).toEqual([{ userId: 'usr-alice', userName: 'Alice', avatar: 'alice.png' }]);
    expect(result[0]).not.toHaveProperty('email');
  });

  it('supports the legacy no-View all-collaborator branch with default pagination', async () => {
    const fixture = createFixture();

    await fixture.service.getCollaborators({ ...shareInfo, view: undefined }, {}, false);
    const collaboratorsQuery = fixture.queries.find(
      (item): item is GetViewCollaboratorsQuery => item instanceof GetViewCollaboratorsQuery
    );

    expect(collaboratorsQuery?.viewId).toBeUndefined();
    expect(collaboratorsQuery?.pagination.limit().toNumber()).toBe(50);
    expect(collaboratorsQuery?.pagination.offset().toNumber()).toBe(0);
  });

  it('binds copy to the authorized View and drops client authority-expanding inputs', async () => {
    const fixture = createFixture();
    const otherViewId = `viw${'x'.repeat(16)}`;

    const result = await fixture.service.getCopy(
      shareInfo,
      {
        viewId: otherViewId,
        ignoreViewQuery: true,
        filterLinkCellSelected: fieldId,
        projection: [fieldId],
        ranges: [
          [0, 0],
          [0, 0],
        ],
      } as never,
      true
    );
    const copyQuery = fixture.queries.find(
      (item): item is GetViewSelectionCopyQuery => item instanceof GetViewSelectionCopyQuery
    );

    expect(copyQuery?.tableId.toString()).toBe(tableId);
    expect(copyQuery?.viewId.toString()).toBe(viewId);
    expect(copyQuery?.canCopyAsEditor).toBe(true);
    expect(copyQuery?.projection?.map((id) => id.toString())).toEqual([fieldId]);
    expect(copyQuery).not.toHaveProperty('ignoreViewQuery');
    expect(copyQuery).not.toHaveProperty('filterLinkCellSelected');
    expect(result).toEqual({
      content: 'Alpha',
      header: [expect.objectContaining({ id: fieldId, name: 'Name', isPrimary: true })],
    });
  });

  it('normalizes an allowed copy filter before dispatching the aggregate query', async () => {
    const fixture = createFixture();

    await fixture.service.getCopy(
      shareInfo,
      {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId, operator: 'is', value: 'Alpha' }],
        },
        ranges: [
          [0, 0],
          [0, 0],
        ],
      },
      false
    );
    const copyQuery = fixture.queries.find(
      (item): item is GetViewSelectionCopyQuery => item instanceof GetViewSelectionCopyQuery
    );

    expect(fixture.queries[0]).toBeInstanceOf(ListFieldsQuery);
    expect(copyQuery?.filter).toEqual({
      conjunction: 'and',
      items: [{ fieldId, operator: 'is', value: 'Alpha' }],
    });
  });

  it('restores cached collapsed groups for a large selection query id', async () => {
    const fixture = createFixture();
    fixture.cacheGet.mockResolvedValue({
      collapsedGroupIds: ['cached-group'],
    });

    await fixture.service.getCopy(
      shareInfo,
      {
        queryId: 'qry_cached',
        collapsedGroupIds: ['request-group'],
        ranges: [
          [0, 0],
          [0, 0],
        ],
      },
      false
    );
    const copyQuery = fixture.queries.find(
      (item): item is GetViewSelectionCopyQuery => item instanceof GetViewSelectionCopyQuery
    );

    expect(fixture.cacheGet).toHaveBeenCalledWith('query-params:qry_cached');
    expect(copyQuery?.collapsedGroupIds).toEqual(['cached-group']);
  });

  it('rejects copy without an authorized View before opening a v2 container', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.getCopy(
        { ...shareInfo, view: undefined },
        {
          ranges: [
            [0, 0],
            [0, 0],
          ],
        },
        false
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('binds aggregation to the authorized View and maps requested totals', async () => {
    const fixture = createFixture(0, undefined, [
      {
        fieldId: primaryFieldId,
        statisticFunc: 'count',
        value: 3,
      },
      {
        fieldId: primaryFieldId,
        statisticFunc: 'unique',
        value: 2,
      },
    ]);

    const result = await fixture.service.getAggregations(shareInfo, {
      field: {
        count: [fieldId],
        unique: [fieldId],
      },
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );

    expect(result).toEqual({
      aggregations: [
        { fieldId, total: { value: 3, aggFunc: 'count' } },
        { fieldId, total: { value: 2, aggFunc: 'unique' } },
      ],
    });
    expect(aggregateQuery?.viewId.toString()).toBe(viewId);
    expect(aggregateQuery?.fields).toEqual([
      { fieldId, statisticFunc: 'count' },
      { fieldId, statisticFunc: 'unique' },
    ]);
  });

  it('normalizes request filters and delegates default View statistics to the Table aggregate', async () => {
    const fixture = createFixture();

    await fixture.service.getAggregations(shareInfo, {
      field: {},
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId, operator: 'is', value: 'Alpha' }],
      },
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );

    expect(fixture.queries[0]).toBeInstanceOf(ListFieldsQuery);
    expect(aggregateQuery?.filter).toEqual({
      conjunction: 'and',
      items: [{ fieldId, operator: 'is', value: 'Alpha' }],
    });
    expect(aggregateQuery?.fields).toBeUndefined();
  });

  it('maps every grouped prefix to the legacy public group id contract', async () => {
    const secondGroupFieldId = `fld${'g'.repeat(16)}`;
    const fixture = createFixture(0, undefined, [
      {
        fieldId: primaryFieldId,
        statisticFunc: 'count',
        value: 3,
      },
      {
        fieldId: primaryFieldId,
        statisticFunc: 'count',
        value: 2,
        groupValues: ['Open'],
      },
      {
        fieldId: primaryFieldId,
        statisticFunc: 'count',
        value: 1,
        groupValues: ['Open', 'High'],
      },
    ]);

    const result = await fixture.service.getAggregations(shareInfo, {
      field: { count: [fieldId] },
      groupBy: [
        { fieldId, order: SortFunc.Asc },
        { fieldId: secondGroupFieldId, order: SortFunc.Desc },
      ],
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );

    expect(aggregateQuery?.groupBy).toEqual([
      { fieldId, order: 'asc' },
      { fieldId: secondGroupFieldId, order: 'desc' },
    ]);
    expect(result.aggregations?.[0]?.total).toEqual({ value: 3, aggFunc: 'count' });
    expect(Object.values(result.aggregations?.[0]?.group ?? {})).toEqual([
      { value: 2, aggFunc: 'count' },
      { value: 1, aggFunc: 'count' },
    ]);
  });

  it('forwards visible-row search to aggregation while keeping the authorized View scope', async () => {
    const fixture = createFixture();

    await fixture.service.getAggregations(shareInfo, {
      field: { count: [fieldId] },
      search: ['Alpha', fieldId, true],
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );

    expect(aggregateQuery?.viewId.toString()).toBe(viewId);
    expect(aggregateQuery?.search).toEqual(['Alpha', fieldId, true]);
  });

  it('returns before persistence when records, View, or grouping are absent', async () => {
    const disabled = createFixture();
    const missingView = createFixture();
    const ungrouped = createFixture();

    await expect(
      disabled.service.getGroupPoints(
        { ...shareInfo, shareMeta: { includeRecords: false } },
        { groupBy: [{ fieldId, order: SortFunc.Asc }] }
      )
    ).resolves.toEqual([]);
    await expect(
      missingView.service.getGroupPoints(
        { ...shareInfo, view: undefined },
        { groupBy: [{ fieldId, order: SortFunc.Asc }] }
      )
    ).resolves.toBeNull();
    await expect(ungrouped.service.getGroupPoints(shareInfo)).resolves.toEqual([]);
    expect(disabled.getContainerForTable).not.toHaveBeenCalled();
    expect(missingView.getContainerForTable).not.toHaveBeenCalled();
    expect(ungrouped.getContainerForTable).not.toHaveBeenCalled();
  });

  it('maps ordered group rows, collapsed headers, search, and overflow through the v2 aggregate', async () => {
    const secondGroupFieldId = `fld${'g'.repeat(16)}`;
    const secondFieldId = FieldId.create(secondGroupFieldId)._unsafeUnwrap();
    const firstGroupId = String(string2Hash(`${fieldId}_A`));
    const fixture = createFixture(
      0,
      undefined,
      [
        { fieldId: primaryFieldId, statisticFunc: 'count', value: 7 },
        {
          fieldId: primaryFieldId,
          statisticFunc: 'count',
          value: 2,
          groupValues: ['A', 'X'],
        },
        {
          fieldId: primaryFieldId,
          statisticFunc: 'count',
          value: 1,
          groupValues: ['A', 'Y'],
        },
        {
          fieldId: primaryFieldId,
          statisticFunc: 'count',
          value: 2,
          groupValues: ['B', 'Z'],
        },
      ],
      [
        { fieldId: primaryFieldId, fieldType: 'singleLineText', order: 'asc' },
        { fieldId: secondFieldId, fieldType: 'singleLineText', order: 'desc' },
      ]
    );

    const result = await fixture.service.getGroupPoints(shareInfo, {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId, operator: 'is', value: 'A' }],
      },
      search: ['A', fieldId, true],
      groupBy: [
        { fieldId, order: SortFunc.Asc },
        { fieldId: secondGroupFieldId, order: SortFunc.Desc },
      ],
      collapsedGroupIds: [firstGroupId],
    });
    const aggregateQuery = fixture.queries.find(
      (query): query is AggregateTableRecordsQuery => query instanceof AggregateTableRecordsQuery
    );

    expect(aggregateQuery?.search).toEqual(['A', fieldId, true]);
    expect(aggregateQuery?.groupBy).toEqual([
      { fieldId, order: 'asc' },
      { fieldId: secondGroupFieldId, order: 'desc' },
    ]);
    expect(result?.filter((point) => point.type === 1)).toEqual([
      { type: 1, count: 2 },
      { type: 1, count: 2 },
    ]);
    expect(result?.find((point) => point.type === 0 && point.value === 'A')).toMatchObject({
      id: firstGroupId,
      isCollapsed: true,
    });
    expect(result?.at(-2)).toMatchObject({ id: 'unknown', value: 'Unknown' });
    expect(result?.at(-1)).toEqual({ type: 1, count: 2 });
  });

  it('decorates attachment group headers without changing their stable group identity', async () => {
    const rawAttachment = [
      { token: 'tok-1', path: 'table/file.png', name: 'file.png', mimetype: 'image/png' },
    ];
    const signedAttachment = [{ ...rawAttachment[0], presignedUrl: 'https://cdn/file.png' }];
    const fixture = createFixture(
      0,
      undefined,
      [
        { fieldId: primaryFieldId, statisticFunc: 'count', value: 1 },
        {
          fieldId: primaryFieldId,
          statisticFunc: 'count',
          value: 1,
          groupValues: [rawAttachment],
        },
      ],
      [{ fieldId: primaryFieldId, fieldType: 'attachment', order: 'asc' }]
    );
    fixture.attachmentDecorator.decorateAttachmentValue.mockResolvedValue(ok(signedAttachment));

    const result = await fixture.service.getGroupPoints(shareInfo, {
      groupBy: [{ fieldId, order: SortFunc.Asc }],
    });

    expect(fixture.attachmentDecorator.decorateAttachmentValue).toHaveBeenCalledWith(rawAttachment);
    expect(result?.[0]).toMatchObject({
      type: 0,
      value: signedAttachment,
      id: String(string2Hash(`${fieldId}_${JSON.stringify(rawAttachment)}`)),
    });
  });

  it('rejects a malformed aggregation before executing the aggregate query', async () => {
    const fixture = createFixture();

    const error = await fixture.service
      .getAggregations(shareInfo, {
        field: { count: [''] },
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(fixture.queries.some((query) => query instanceof AggregateTableRecordsQuery)).toBe(
      false
    );
  });

  it('returns before resolving any v2 dependency when records are disabled', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getRowCount({
      ...shareInfo,
      shareMeta: { includeRecords: false },
    });

    expect(result).toEqual({ rowCount: 0 });
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('requires a search tuple before resolving persistence', async () => {
    const fixture = createFixture();

    const error = await fixture.service
      .getSearchCount(shareInfo, {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('binds search count to the authorized View and ignores caller View overrides', async () => {
    const fixture = createFixture(2);

    const result = await fixture.service.getSearchCount(shareInfo, {
      viewId: candidateViewId,
      ignoreViewQuery: true,
      search: ['Alpha', fieldId, false],
    });
    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );

    expect(result).toEqual({ count: 2 });
    expect(countQuery?.viewId).toBe(viewId);
    expect(countQuery?.ignoreViewQuery).toBeUndefined();
    expect(countQuery?.search).toEqual(['Alpha', fieldId, true]);
  });

  it('returns null before resolving v2 dependencies when search-index records are disabled', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getSearchIndex(
      { ...shareInfo, shareMeta: { includeRecords: false } },
      { take: 10, search: ['Alpha', fieldId, false] }
    );

    expect(result).toBeNull();
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('validates search-index input before resolving persistence', async () => {
    const fixture = createFixture();

    const missingSearch = await fixture.service
      .getSearchIndex(shareInfo, { take: 10 })
      .catch((caught: unknown) => caught);
    const excessiveTake = await fixture.service
      .getSearchIndex(shareInfo, { take: 1001, search: ['Alpha', fieldId, false] })
      .catch((caught: unknown) => caught);

    expect(missingSearch).toBeInstanceOf(HttpException);
    expect(excessiveTake).toBeInstanceOf(HttpException);
    expect(fixture.getContainerForTable).not.toHaveBeenCalled();
  });

  it('treats search-index take 0 as the 1000-row cap', async () => {
    const fixture = createFixture(1, []);

    await fixture.service.getSearchIndex(shareInfo, {
      take: 0,
      search: ['Alpha', fieldId, false],
    });
    const searchQuery = fixture.queries.find(
      (query): query is ListTableRecordsQuery => query instanceof ListTableRecordsQuery
    );
    expect(searchQuery?.pagination.limit().toNumber()).toBe(1000);
  });

  it('projects complete-View search indexes from the authorized aggregate scope', async () => {
    const recordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
    const fixture = createFixture(1, [{ index: 3, fieldId: primaryFieldId, recordId }]);

    const result = await fixture.service.getSearchIndex(shareInfo, {
      take: 10,
      projection: [fieldId],
      viewId: candidateViewId,
      ignoreViewQuery: true,
      groupBy: [{ fieldId, order: SortFunc.Asc }],
      orderBy: [{ fieldId, order: SortFunc.Desc }],
      search: ['Alpha', fieldId, false],
    });
    const searchQuery = fixture.queries.find(
      (query): query is ListTableRecordsQuery => query instanceof ListTableRecordsQuery
    );

    expect(result).toEqual([{ index: 3, fieldId, recordId: recordId.toString() }]);
    expect(searchQuery?.viewId).toBe(viewId);
    expect(searchQuery?.ignoreViewQuery).toBeUndefined();
    expect(searchQuery?.includeSearchFieldMatches).toBe(true);
    expect(searchQuery?.searchIndexMode).toBe('view');
    expect(searchQuery?.search).toEqual(['Alpha', fieldId, true]);
    expect(searchQuery?.sort).toEqual([
      { fieldId, order: 'asc' },
      { fieldId, order: 'desc' },
    ]);
  });

  it('uses matched-row numbering and returns null when no field matches remain', async () => {
    const fixture = createFixture(0, []);

    const result = await fixture.service.getSearchIndex(shareInfo, {
      skip: 2,
      take: 5,
      search: ['missing', '', true],
    });
    const searchQuery = fixture.queries.find(
      (query): query is ListTableRecordsQuery => query instanceof ListTableRecordsQuery
    );

    expect(result).toBeNull();
    expect(searchQuery?.searchIndexMode).toBe('matched');
    expect(searchQuery?.pagination.offset().toNumber()).toBe(2);
    expect(searchQuery?.pagination.limit().toNumber()).toBe(5);
  });

  it('counts through CountTableRecordsQuery with the aggregate-owned View', async () => {
    const fixture = createFixture(7);

    const result = await fixture.service.getRowCount(shareInfo);
    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );

    expect(result).toEqual({ rowCount: 7 });
    expect(countQuery?.viewId).toBe(viewId);
    expect(countQuery?.ignoreViewQuery).toBeUndefined();
  });

  it('gives the link candidate scope priority over a caller filter', async () => {
    const fixture = createFixture(1);

    await fixture.service.getRowCount(
      {
        ...shareInfo,
        linkOptions: {
          filterByViewId: candidateViewId,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId, operator: 'is', value: 'candidate' }],
          },
        },
      },
      {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId, operator: 'is', value: 'caller' }],
        },
      }
    );
    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );

    expect(fixture.queries[0]).toBeInstanceOf(ListFieldsQuery);
    expect(countQuery?.viewId).toBe(candidateViewId);
    expect(countQuery?.filter).toEqual({
      conjunction: 'and',
      items: [{ fieldId, operator: 'is', value: 'candidate' }],
    });
  });

  it('ignores candidate View and filter defaults for already-selected link records', async () => {
    const fixture = createFixture(1);
    const hostRecordId = `rec${'r'.repeat(16)}`;

    await fixture.service.getRowCount(
      {
        ...shareInfo,
        linkOptions: {
          filterByViewId: candidateViewId,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId, operator: 'is', value: 'candidate' }],
          },
        },
      },
      {
        filterLinkCellSelected: [fieldId, hostRecordId],
        selectedRecordIds: [`rec${'x'.repeat(16)}`],
      }
    );
    const countQuery = fixture.queries.find(
      (query): query is CountTableRecordsQuery => query instanceof CountTableRecordsQuery
    );

    expect(fixture.queries).toHaveLength(1);
    expect(countQuery?.viewId).toBe(viewId);
    expect(countQuery?.ignoreViewQuery).toBe(true);
    expect(countQuery?.filter).toBeUndefined();
    expect(countQuery?.filterLinkCellSelected).toEqual([fieldId, hostRecordId]);
    expect(countQuery?.selectedRecordIds).toEqual([`rec${'x'.repeat(16)}`]);
  });

  it('rejects mutually exclusive link candidate and selected modes before persistence', async () => {
    const fixture = createFixture();

    const error = await fixture.service
      .getRowCount(shareInfo, {
        filterLinkCellCandidate: fieldId,
        filterLinkCellSelected: fieldId,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(fixture.queries).toHaveLength(0);
  });
});
