import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  DateFormattingPreset,
  FieldKeyType,
  FieldType,
  TimeFormatting,
} from '@teable/core';
import type { IFilter, ITableFullVo } from '@teable/openapi';
import {
  getRecords as apiGetRecords,
  getRowCount,
  getSearchCount,
  getSearchIndex,
} from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable, updateViewFilter } from './utils/init-app';

const withForceV2All = async <T>(callback: () => Promise<T>) => {
  const previousForceV2All = process.env.FORCE_V2_ALL;
  process.env.FORCE_V2_ALL = 'true';
  try {
    return await callback();
  } finally {
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  }
};

const startOfUtcDay = (date: Date) => {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy.toISOString();
};

const shiftUtcDays = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return startOfUtcDay(copy);
};

describe('Field search respects view filter (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;
  let viewId: string;
  let dateFieldId: string;
  let typeFieldId: string;
  let nameFieldId: string;
  let todayIso: string;
  let otherDayIso: string;
  let exactDateFilter: IFilter;
  let todayFilter: IFilter;
  let multiFilter: IFilter;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const now = new Date();
    todayIso = startOfUtcDay(now);
    otherDayIso = shiftUtcDays(now, -4);

    table = await createTable(baseId, {
      name: 'search_view_filter_t6874',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'ShipDate',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        },
        {
          name: 'Type',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { name: 'Cupcake', color: Colors.Orange },
              { name: 'Other', color: Colors.Gray },
            ],
          },
        },
      ],
      records: [
        { fields: { Name: 'today-match', ShipDate: todayIso, Type: 'Cupcake' } },
        { fields: { Name: 'today-other', ShipDate: todayIso, Type: 'Other' } },
        { fields: { Name: 'other-match', ShipDate: otherDayIso, Type: 'Cupcake' } },
        {
          fields: {
            Name: 'future-match',
            ShipDate: shiftUtcDays(now, 4),
            Type: 'Cupcake',
          },
        },
      ],
    });
    viewId = table.defaultViewId!;
    dateFieldId = table.fields.find((field) => field.name === 'ShipDate')!.id;
    typeFieldId = table.fields.find((field) => field.name === 'Type')!.id;
    nameFieldId = table.fields.find((field) => field.name === 'Name')!.id;

    exactDateFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'is',
          value: {
            mode: 'exactDate',
            exactDate: todayIso,
            timeZone: 'UTC',
          },
        },
      ],
    };
    todayFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'is',
          value: {
            mode: 'today',
            timeZone: 'UTC',
          },
        },
      ],
    };
    multiFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'is',
          value: {
            mode: 'today',
            timeZone: 'UTC',
          },
        },
        {
          fieldId: typeFieldId,
          operator: 'is',
          value: 'Cupcake',
        },
      ],
    };

    await updateViewFilter(table.id, viewId, { filter: exactDateFilter });
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app?.close();
  });

  const search: [string, string, boolean] = ['Cup', '', true];

  const namesOf = (records: { fields: Record<string, unknown> }[]) =>
    records.map((record) => record.fields.Name);

  const listByViewSearch = async () => {
    const { data } = await apiGetRecords(table.id, {
      fieldKeyType: FieldKeyType.Name,
      viewId,
      search: [search[0], typeFieldId, true],
      take: 100,
    });
    return namesOf(data.records);
  };

  const listByGridQuery = async (filter: IFilter) => {
    const { data } = await apiGetRecords(table.id, {
      fieldKeyType: FieldKeyType.Name,
      viewId,
      ignoreViewQuery: true,
      filter,
      search: [search[0], typeFieldId, true],
      take: 100,
    });
    return namesOf(data.records);
  };

  it('keeps view-filtered rows when hide-not-match search is applied via viewId', async () => {
    await expect(listByViewSearch()).resolves.toEqual(['today-match']);
  });

  it('keeps view-filtered rows on the grid ignoreViewQuery + inlined filter path', async () => {
    await expect(listByGridQuery(exactDateFilter)).resolves.toEqual(['today-match']);
  });

  it('keeps date-is-today rows when hide-not-match search is applied', async () => {
    await updateViewFilter(table.id, viewId, { filter: todayFilter });
    try {
      await expect(listByViewSearch()).resolves.toEqual(['today-match']);
      await expect(listByGridQuery(todayFilter)).resolves.toEqual(['today-match']);
    } finally {
      await updateViewFilter(table.id, viewId, { filter: exactDateFilter });
    }
  });

  it('keeps every view filter when hide-not-match search includes a date field', async () => {
    const dateSearch: [string, string, boolean] = [
      todayIso.slice(0, 10),
      `${nameFieldId},${dateFieldId}`,
      true,
    ];
    const assertIntersection = async () => {
      const { data: viewRecords } = await apiGetRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        viewId,
        search: dateSearch,
        take: 100,
      });
      expect(namesOf(viewRecords.records)).toEqual(['today-match']);

      const { data: gridRecords } = await apiGetRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        viewId,
        ignoreViewQuery: true,
        filter: multiFilter,
        search: dateSearch,
        take: 100,
      });
      expect(namesOf(gridRecords.records)).toEqual(['today-match']);

      const { data: rowCount } = await getRowCount(table.id, {
        viewId,
        search: dateSearch,
      });
      expect(rowCount.rowCount).toBe(1);
    };

    await updateViewFilter(table.id, viewId, { filter: multiFilter });
    try {
      await assertIntersection();
      await withForceV2All(assertIntersection);
    } finally {
      await updateViewFilter(table.id, viewId, { filter: exactDateFilter });
    }
  });

  it('counts, search-counts, and search-index hits stay inside the view filter', async () => {
    const typeSearch: [string, string, boolean] = ['Cup', typeFieldId, true];

    const { data: rowCount } = await getRowCount(table.id, {
      viewId,
      search: typeSearch,
    });
    expect(rowCount.rowCount).toBe(1);

    const { data: searchCount } = await getSearchCount(table.id, {
      viewId,
      search: typeSearch,
    });
    expect(searchCount.count).toBe(1);

    const { data: searchIndex } = await getSearchIndex(table.id, {
      viewId,
      take: 100,
      search: typeSearch,
    });
    expect(searchIndex).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: typeFieldId,
          recordId: table.records.find((record) => record.fields.Name === 'today-match')?.id,
        }),
      ])
    );
    expect(searchIndex).toHaveLength(1);
  });

  it('still searches the full table when ignoreViewQuery is set without a client filter', async () => {
    const typeSearch: [string, string, boolean] = ['Cup', typeFieldId, true];

    const { data: searchCount } = await getSearchCount(table.id, {
      viewId,
      ignoreViewQuery: true,
      search: typeSearch,
    });
    expect(searchCount.count).toBe(3);

    const { data: searchIndex } = await getSearchIndex(table.id, {
      viewId,
      ignoreViewQuery: true,
      take: 100,
      search: typeSearch,
    });
    expect(searchIndex).toHaveLength(3);
  });

  it('keeps the same intersection on the force-v2 compatibility path', async () => {
    await withForceV2All(async () => {
      await expect(listByViewSearch()).resolves.toEqual(['today-match']);
      await expect(listByGridQuery(exactDateFilter)).resolves.toEqual(['today-match']);

      const { data: searchIndex } = await getSearchIndex(table.id, {
        viewId,
        take: 100,
        search: ['Cup', typeFieldId, true],
      });
      expect(searchIndex).toHaveLength(1);

      const { data: searchCount } = await getSearchCount(table.id, {
        viewId,
        search: ['Cup', typeFieldId, true],
      });
      expect(searchCount.count).toBe(1);
    });
  });
});
