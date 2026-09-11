/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention -- OpenTelemetry attributes use dotted protocol names. */
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Colors,
  DateFormattingPreset,
  DriverClient,
  FieldType,
  NumberFormattingType,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import type { IFilter, ISearchIndexByQueryRo, ITableFullVo } from '@teable/openapi';
import { getSearchCount, getSearchIndex } from '@teable/openapi';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  disposeTableQueryObservationPublisher,
  ensureTableQueryObservationSchema,
  ensureTableQueryOpsSchema,
  PostgresTableSearchVectorReconciler,
  type TableQueryObservationDatabase,
  type TableQueryOpsDatabase,
  type UnknownPostgresDatabase,
} from '@teable/v2-adapter-table-query-ops-postgres';
import {
  ActorId,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type ITableRepository,
} from '@teable/v2-core';
import { BufferedTableQueryObservationPublisher } from '@teable/v2-table-query-ops';
import { sql, type Kysely } from 'kysely';
import { Client } from 'pg';
import { TableQueryObservationRuntimeService } from '../src/features/v2/table-query-observation-runtime.service';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { OpenTelemetryTracer } from '../src/features/v2/v2-tracer.adapter';
import { getError } from './utils/get-error';
import {
  createField,
  createTable,
  getFields,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateViewFilter,
} from './utils/init-app';

/**
 * Product-API coverage for the authed v2 search-count / search-index adapters.
 * FORCE_V2_ALL is required so these routes hit AggregationOpenApiV2Service
 * instead of the v1 aggregation service.
 *
 * v2 search-count is matching-row count (share-view parity), not v1 cell-hit SUM.
 */
describe('v2 authed search-count and search-index (e2e)', () => {
  let app: INestApplication;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;
  let viewId: string;
  let nameFieldId: string;
  let notesFieldId: string;
  let amountFieldId: string;
  let shipDateFieldId: string;
  let doneFieldId: string;
  let statusFieldId: string;
  let tagsFieldId: string;
  let ratingFieldId: string;
  let ownerFieldId: string;
  let nameUpperFieldId: string;
  let openAlphaId: string;
  let closedAlphaId: string;
  let openOtherId: string;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const appCtx = await initApp();
    app = appCtx.app;

    table = await createTable(baseId, {
      name: 'search_v2_field_matrix_t6874',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Notes', type: FieldType.LongText },
        {
          name: 'Amount',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 1 } },
        },
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
        { name: 'Done', type: FieldType.Checkbox },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { name: 'Open', color: Colors.Green },
              { name: 'Closed', color: Colors.Gray },
            ],
          },
        },
        {
          name: 'Tags',
          type: FieldType.MultipleSelect,
          options: {
            choices: [
              { name: 'urgent', color: Colors.Red },
              { name: 'backlog', color: Colors.Blue },
            ],
          },
        },
        { name: 'Rating', type: FieldType.Rating },
        {
          name: 'Owner',
          type: FieldType.User,
          options: { isMultiple: false, shouldNotify: false },
        },
      ],
      records: [
        {
          fields: {
            Name: 'open-alpha',
            Notes: 'hello\nnewYork alpha, London',
            Amount: 19,
            ShipDate: '2022-03-02T12:00:00.000Z',
            Done: true,
            Status: 'Open',
            Tags: ['urgent', 'backlog'],
            Rating: 4,
            Owner: {
              id: globalThis.testConfig.userId,
              title: globalThis.testConfig.userName,
              email: globalThis.testConfig.email,
            },
          },
        },
        {
          fields: {
            Name: 'open-other',
            Amount: 20.3,
            Status: 'Open',
            Tags: ['backlog'],
            Rating: 2,
          },
        },
        {
          fields: {
            Name: 'closed-alpha',
            Amount: 19,
            ShipDate: '2022-03-02T12:00:00.000Z',
            Status: 'Closed',
            Tags: ['urgent'],
          },
        },
        {
          fields: {
            Name: 'closed-url',
            Notes: 'https://example.com/path?q=1',
            Status: 'Closed',
          },
        },
        {
          fields: {
            Name: '100 items',
            Amount: 100,
            Status: 'Open',
          },
        },
        {
          fields: {
            Name: 'notepad++',
            Notes: '50% off_sale',
            Status: 'Open',
          },
        },
        { fields: { Name: 'empty-open', Status: 'Open' } },
      ],
    });

    viewId = table.defaultViewId!;
    nameFieldId = table.fields.find((field) => field.name === 'Name')!.id;
    notesFieldId = table.fields.find((field) => field.name === 'Notes')!.id;
    amountFieldId = table.fields.find((field) => field.name === 'Amount')!.id;
    shipDateFieldId = table.fields.find((field) => field.name === 'ShipDate')!.id;
    doneFieldId = table.fields.find((field) => field.name === 'Done')!.id;
    statusFieldId = table.fields.find((field) => field.name === 'Status')!.id;
    tagsFieldId = table.fields.find((field) => field.name === 'Tags')!.id;
    ratingFieldId = table.fields.find((field) => field.name === 'Rating')!.id;
    ownerFieldId = table.fields.find((field) => field.name === 'Owner')!.id;
    openAlphaId = table.records.find((record) => record.fields.Name === 'open-alpha')!.id;
    closedAlphaId = table.records.find((record) => record.fields.Name === 'closed-alpha')!.id;
    openOtherId = table.records.find((record) => record.fields.Name === 'open-other')!.id;

    const nameUpper = await createField(table.id, {
      name: 'NameUpper',
      type: FieldType.Formula,
      options: { expression: `UPPER({${nameFieldId}})` },
    });
    nameUpperFieldId = nameUpper.id;

    await updateViewFilter(table.id, viewId, {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId, operator: 'is', value: 'Open' }],
      },
    });
  }, 30_000);

  afterAll(async () => {
    if (table?.id) {
      await permanentDeleteTable(baseId, table.id);
    }
    await app?.close();
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  });

  const countOf = async (
    search: [string, string, boolean],
    query: Omit<Parameters<typeof getSearchCount>[1], 'search'> = {}
  ) => {
    const { data } = await getSearchCount(table.id, { search, ...query });
    return data.count;
  };

  const hitsOf = async (
    search: [string, string, boolean],
    query: Omit<ISearchIndexByQueryRo, 'search' | 'take'> = {}
  ) => {
    const { data } = await getSearchIndex(table.id, {
      take: 100,
      search,
      ...query,
    });
    return Array.isArray(data) ? data : [];
  };

  describe('validation', () => {
    it('rejects a missing search tuple on search-count', async () => {
      const error = await getError(() => getSearchCount(table.id, { viewId }));
      expect(error?.status).toBe(400);
    });

    it('rejects a missing search tuple on search-index', async () => {
      const error = await getError(() => getSearchIndex(table.id, { take: 10, viewId } as never));
      expect(error?.status).toBe(400);
    });

    it('rejects search-index pages larger than 1000', async () => {
      const error = await getError(() =>
        getSearchIndex(table.id, { take: 1001, search: ['alpha', nameFieldId, true] })
      );
      expect(error?.status).toBe(400);
    });
  });

  describe('view filter intersection', () => {
    it('keeps targeted text search inside the Open view filter', async () => {
      const hits = await hitsOf(['alpha', nameFieldId, true], { viewId });
      expect(await countOf(['alpha', nameFieldId, true], { viewId })).toBe(1);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ fieldId: nameFieldId, recordId: openAlphaId, index: 1 });
    });

    it('does not return Closed rows that would match the same text', async () => {
      const hits = await hitsOf(['alpha', nameFieldId, true], { viewId });
      expect(hits.map((hit) => hit.recordId)).not.toContain(closedAlphaId);
    });

    it('counts matching rows, not per-cell hits, when several fields match', async () => {
      const search: [string, string, boolean] = ['alpha', `${nameFieldId},${notesFieldId}`, true];
      expect(await countOf(search, { viewId })).toBe(1);
      const hits = await hitsOf(search, { viewId });
      expect(hits.map((hit) => hit.recordId)).toEqual([openAlphaId, openAlphaId]);
      expect(hits.map((hit) => hit.fieldId).sort()).toEqual([nameFieldId, notesFieldId].sort());
    });

    it('still searches the full table when ignoreViewQuery is set without a client filter', async () => {
      expect(await countOf(['alpha', nameFieldId, true], { viewId, ignoreViewQuery: true })).toBe(
        2
      );
      const hits = await hitsOf(['alpha', nameFieldId, true], { viewId, ignoreViewQuery: true });
      expect(hits.map((hit) => hit.recordId).sort()).toEqual([openAlphaId, closedAlphaId].sort());
    });

    it('ANDs an explicit client filter with the stored view filter', async () => {
      expect(
        await countOf(['open', nameFieldId, true], {
          viewId,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: tagsFieldId, operator: 'hasAllOf', value: ['urgent'] }],
          },
        })
      ).toBe(1);
    });

    it('returns no hits when the client filter contradicts the view filter', async () => {
      const filter: IFilter = {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId, operator: 'is', value: 'Closed' }],
      };
      expect(await countOf(['alpha', nameFieldId, true], { viewId, filter })).toBe(0);
      expect(await hitsOf(['alpha', nameFieldId, true], { viewId, filter })).toEqual([]);
    });

    it('uses only the client filter when ignoreViewQuery is set', async () => {
      expect(
        await countOf(['alpha', nameFieldId, true], {
          viewId,
          ignoreViewQuery: true,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: statusFieldId, operator: 'is', value: 'Closed' }],
          },
        })
      ).toBe(1);
    });
  });

  describe('field types', () => {
    it('matches single-line text case-insensitively and rejects a miss', async () => {
      expect(await countOf(['ALPHA', nameFieldId, true], { ignoreViewQuery: true })).toBe(2);
      expect(await countOf(['no-such-row', nameFieldId, true], { ignoreViewQuery: true })).toBe(0);
      expect(await hitsOf(['no-such-row', nameFieldId, true], { ignoreViewQuery: true })).toEqual(
        []
      );
    });

    it('matches long-text substrings including values after a newline', async () => {
      const hits = await hitsOf(['newYork', notesFieldId, true], { viewId });
      expect(await countOf(['newYork', notesFieldId, true], { viewId })).toBe(1);
      expect(hits).toEqual(
        expect.arrayContaining([expect.objectContaining({ recordId: openAlphaId })])
      );
    });

    it('matches numbers against formatted precision text and rejects a too-precise miss', async () => {
      expect(await countOf(['19.0', amountFieldId, true], { ignoreViewQuery: true })).toBe(2);
      expect(await countOf(['19.00', amountFieldId, true], { ignoreViewQuery: true })).toBe(0);
      expect(await countOf(['0.3', amountFieldId, true], { viewId })).toBe(1);
    });

    it('does not match a targeted number field for non-numeric text', async () => {
      expect(await countOf(['alpha', amountFieldId, true], { ignoreViewQuery: true })).toBe(0);
    });

    it('matches a targeted date against the formatted day and rejects a nearby miss', async () => {
      expect(await countOf(['2022-03-02', shipDateFieldId, true], { ignoreViewQuery: true })).toBe(
        2
      );
      expect(await countOf(['2022-03-03', shipDateFieldId, true], { ignoreViewQuery: true })).toBe(
        0
      );
    });

    it('excludes date fields from all-field hide-not-match search', async () => {
      expect(await countOf(['2022-03-02', '', true], { ignoreViewQuery: true })).toBe(0);
    });

    it('matches single-select choice names and rejects a missing choice', async () => {
      expect(await countOf(['Closed', statusFieldId, true], { ignoreViewQuery: true })).toBe(2);
      expect(await countOf(['Missing', statusFieldId, true], { ignoreViewQuery: true })).toBe(0);
    });

    it('matches a multi-select tag and stays inside the view filter', async () => {
      expect(await countOf(['urgent', tagsFieldId, true], { viewId })).toBe(1);
      expect(await countOf(['urgent', tagsFieldId, true], { ignoreViewQuery: true })).toBe(2);
    });

    it('matches joined multi-select cell text in stored order only', async () => {
      expect(await countOf(['urgent, backlog', tagsFieldId, true], { viewId })).toBe(1);
      expect(await countOf(['backlog, urgent', tagsFieldId, true], { viewId })).toBe(0);
    });

    it('does not filter rows when the only target is a checkbox field', async () => {
      expect(await countOf(['true', doneFieldId, true], { ignoreViewQuery: true })).toBe(
        table.records.length
      );
    });

    it('matches a rating against its numeric text and rejects a miss', async () => {
      expect(await countOf(['4', ratingFieldId, true], { viewId })).toBe(1);
      expect(await countOf(['5', ratingFieldId, true], { viewId })).toBe(0);
    });

    it('matches a user cell by display name and rejects a miss', async () => {
      expect(await countOf([globalThis.testConfig.userName, ownerFieldId, true], { viewId })).toBe(
        1
      );
      expect(await countOf(['ghost-user', ownerFieldId, true], { viewId })).toBe(0);
    });

    it('matches a formula cell against its computed text', async () => {
      expect(await countOf(['OPEN-ALPHA', nameUpperFieldId, true], { viewId })).toBe(1);
      expect(await countOf(['CLOSED-ALPHA', nameUpperFieldId, true], { viewId })).toBe(0);
      expect(
        await countOf(['CLOSED-ALPHA', nameUpperFieldId, true], { ignoreViewQuery: true })
      ).toBe(1);
    });
  });

  describe('special characters and all-field search', () => {
    it('matches a plus sign literally', async () => {
      expect(await countOf(['notepad++', nameFieldId, true], { viewId })).toBe(1);
      expect(await countOf(['notepad+', nameFieldId, true], { viewId })).toBe(1);
    });

    it('matches a question mark in a URL without treating it as a wildcard', async () => {
      expect(
        await countOf(['https://example.com/path?q=1', notesFieldId, true], {
          ignoreViewQuery: true,
        })
      ).toBe(1);
    });

    it('treats percent and underscore as literals rather than LIKE wildcards', async () => {
      expect(await countOf(['50%', notesFieldId, true], { viewId })).toBe(1);
      expect(await countOf(['off_sale', notesFieldId, true], { viewId })).toBe(1);
      expect(await countOf(['offXsale', notesFieldId, true], { viewId })).toBe(0);
    });

    it('matches all-field numeric text on both formatted numbers and text cells', async () => {
      expect(await countOf(['100', '', true], { viewId })).toBe(1);
    });

    it('supports comma-separated field keys', async () => {
      expect(await countOf(['100', `${nameFieldId},${amountFieldId}`, true], { viewId })).toBe(1);
      expect(await countOf(['100', `${notesFieldId},${doneFieldId}`, true], { viewId })).toBe(0);
    });

    it('returns no hits for a term that exists only outside the view', async () => {
      expect(await countOf(['closed-url', nameFieldId, true], { viewId })).toBe(0);
      expect(await hitsOf(['closed-url', nameFieldId, true], { viewId })).toEqual([]);
      expect(await countOf(['closed-url', nameFieldId, true], { ignoreViewQuery: true })).toBe(1);
    });
  });

  describe('search-index modes and pagination', () => {
    it('numbers hide-not-match hits from 1 among matched rows', async () => {
      const hits = await hitsOf(['alpha', nameFieldId, true], { viewId });
      expect(hits).toEqual([
        expect.objectContaining({ recordId: openAlphaId, fieldId: nameFieldId, index: 1 }),
      ]);
    });

    it('still returns the in-view hit when hide-not-match is off', async () => {
      const hits = await hitsOf(['alpha', nameFieldId, false], { viewId });
      expect(hits.map((hit) => hit.recordId)).toEqual([openAlphaId]);
      expect(hits[0]?.index).toBeGreaterThan(0);
    });

    it('pages search-index hits with take and skip', async () => {
      const first = await getSearchIndex(table.id, {
        take: 1,
        search: ['open-', nameFieldId, true],
        viewId,
      });
      const second = await getSearchIndex(table.id, {
        take: 1,
        skip: 1,
        search: ['open-', nameFieldId, true],
        viewId,
      });
      const pastEnd = await getSearchIndex(table.id, {
        take: 1,
        skip: 20,
        search: ['open-', nameFieldId, true],
        viewId,
      });

      expect(Array.isArray(first.data) ? first.data : []).toHaveLength(1);
      expect(Array.isArray(second.data) ? second.data : []).toHaveLength(1);
      expect(
        (Array.isArray(first.data) ? first.data[0]?.recordId : undefined) !==
          (Array.isArray(second.data) ? second.data[0]?.recordId : undefined)
      ).toBe(true);
      expect(Array.isArray(pastEnd.data) ? pastEnd.data : []).toEqual([]);
    });

    it('keeps paged hits inside the current view', async () => {
      const page = await getSearchIndex(table.id, {
        take: 10,
        search: ['open-', nameFieldId, true],
        viewId,
      });
      const recordIds = (Array.isArray(page.data) ? page.data : []).map((hit) => hit.recordId);
      expect(recordIds.sort()).toEqual([openAlphaId, openOtherId].sort());
      expect(recordIds).not.toContain(closedAlphaId);
    });
  });

  describe('link, lookup, rollup, and formula fields', () => {
    let peopleTable: ITableFullVo;
    let projectsTable: ITableFullVo;
    let linkFieldId: string;
    let lookupFieldId: string;
    let rollupFieldId: string;
    let formulaFieldId: string;
    let websiteId: string;

    beforeAll(async () => {
      peopleTable = await createTable(baseId, {
        name: 'search_v2_people_t6874',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Score', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'Alice Johnson', Score: 100 } },
          { fields: { Name: 'Bob Smith', Score: 200 } },
        ],
      });

      projectsTable = await createTable(baseId, {
        name: 'search_v2_projects_t6874',
        fields: [
          { name: 'Project', type: FieldType.SingleLineText },
          {
            name: 'Owner',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: peopleTable.id,
            },
          },
        ],
        records: [
          {
            fields: {
              Project: 'Website Redesign',
              Owner: [{ id: peopleTable.records[0].id }],
            },
          },
          {
            fields: {
              Project: 'Mobile App',
              Owner: [{ id: peopleTable.records[1].id }],
            },
          },
        ],
      });

      projectsTable.fields = await getFields(projectsTable.id);
      const projectField = projectsTable.fields.find((field) => field.name === 'Project')!;
      linkFieldId = projectsTable.fields.find((field) => field.type === FieldType.Link)!.id;
      websiteId = projectsTable.records.find(
        (record) => record.fields.Project === 'Website Redesign'
      )!.id;

      const peopleNameField = peopleTable.fields.find((field) => field.name === 'Name')!;
      const peopleScoreField = peopleTable.fields.find((field) => field.name === 'Score')!;

      lookupFieldId = (
        await createField(projectsTable.id, {
          name: 'Owner Name Lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: peopleTable.id,
            lookupFieldId: peopleNameField.id,
            linkFieldId,
          },
        })
      ).id;

      rollupFieldId = (
        await createField(projectsTable.id, {
          name: 'Owner Score Total',
          type: FieldType.Rollup,
          options: { expression: 'sum({values})' },
          lookupOptions: {
            foreignTableId: peopleTable.id,
            lookupFieldId: peopleScoreField.id,
            linkFieldId,
          },
        })
      ).id;

      formulaFieldId = (
        await createField(projectsTable.id, {
          name: 'Project Uppercase',
          type: FieldType.Formula,
          options: { expression: `UPPER({${projectField.id}})` },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (projectsTable?.id) {
        await permanentDeleteTable(baseId, projectsTable.id);
      }
      if (peopleTable?.id) {
        await permanentDeleteTable(baseId, peopleTable.id);
      }
    });

    const projectCount = async (search: [string, string, boolean]) => {
      const { data } = await getSearchCount(projectsTable.id, { search });
      return data.count;
    };

    const projectHits = async (search: [string, string, boolean]) => {
      const { data } = await getSearchIndex(projectsTable.id, { take: 100, search });
      return Array.isArray(data) ? data : [];
    };

    it.each([
      { label: 'link', getFieldId: () => linkFieldId, searchValue: 'Alice Johnson' },
      { label: 'lookup', getFieldId: () => lookupFieldId, searchValue: 'Alice Johnson' },
      { label: 'rollup', getFieldId: () => rollupFieldId, searchValue: '100' },
      { label: 'formula', getFieldId: () => formulaFieldId, searchValue: 'WEBSITE REDESIGN' },
    ])('matches a $label field and hides the other row', async ({ getFieldId, searchValue }) => {
      const search: [string, string, boolean] = [searchValue, getFieldId(), true];
      expect(await projectCount(search)).toBe(1);
      expect((await projectHits(search)).map((hit) => hit.recordId)).toEqual([websiteId]);
    });

    it.each([
      { label: 'link', searchValue: 'Alice Johnson' },
      { label: 'lookup', searchValue: 'Alice Johnson' },
      { label: 'rollup', searchValue: '100' },
      { label: 'formula', searchValue: 'WEBSITE REDESIGN' },
    ])('matches $label values in an all-field search', async ({ searchValue }) => {
      expect(await projectCount([searchValue, '', true])).toBe(1);
    });

    it('rejects a linked-record miss and a swapped rollup value', async () => {
      expect(await projectCount(['Carol Danvers', linkFieldId, true])).toBe(0);
      expect(await projectCount(['999', rollupFieldId, true])).toBe(0);
      expect(await projectHits(['Carol Danvers', linkFieldId, true])).toEqual([]);
    });
  });
});

describe.skipIf(globalThis.testConfig.driver !== DriverClient.Pg)(
  'v2 standalone indexed records search T7223 (e2e)',
  () => {
    let app: INestApplication;
    let table: ITableFullVo;
    let metaDb: Kysely<UnknownPostgresDatabase>;
    let fixtureSchemaReady = false;
    let runtimeMode: 'auto' | 'off' = 'auto';
    let restoreRuntimeConfig: (() => void) | undefined;
    const baseId = globalThis.testConfig.baseId;

    beforeAll(async () => {
      vi.stubEnv('FORCE_V2_ALL', 'true');
      vi.stubEnv('V2_TABLE_QUERY_OPS_ENABLED', 'false');
      vi.stubEnv('V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME', 'auto');
      vi.stubEnv('V2_TABLE_QUERY_OPS_MIN_WINDOW_REQUESTS', '1');
      // Nest's validated startup environment takes precedence over ConfigService.set.
      // Override configuration only; the resolver, repository and HTTP path stay real.
      const getConfig = ConfigService.prototype.get;
      const configOverride = vi.spyOn(ConfigService.prototype, 'get').mockImplementation(function (
        this: ConfigService,
        ...args
      ) {
        if (args[0] === 'V2_TABLE_QUERY_OPS_ENABLED') return 'false';
        if (args[0] === 'V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME') return runtimeMode;
        return getConfig.apply(this, args);
      });
      restoreRuntimeConfig = () => configOverride.mockRestore();
      const appContext = await initApp();
      app = appContext.app;
    });

    afterAll(async () => {
      try {
        if (table?.id) {
          await permanentDeleteTable(baseId, table.id);
          if (fixtureSchemaReady) {
            await sql`DELETE FROM table_query_search_vector_config WHERE table_id = ${table.id}`.execute(
              metaDb
            );
          }
        }
      } finally {
        await app?.close();
        restoreRuntimeConfig?.();
        vi.unstubAllEnvs();
      }
    });

    it('uses an existing generated-text index without observations and preserves results when runtime is off', async () => {
      table = await createTable(baseId, {
        name: 'standalone_search_t7223',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Notes', type: FieldType.LongText },
        ],
        records: [
          { fields: { Title: 'prefix needleunique suffix', Notes: 'ordinary note' } },
          { fields: { Title: 'ordinary title', Notes: 'NEEDLEUNIQUE in notes' } },
          { fields: { Title: 'unrelated title', Notes: 'unrelated note' } },
        ],
      });
      const container = await app.get(V2ContainerService).getContainerForTable(table.id);
      metaDb = container.resolve<Kysely<UnknownPostgresDatabase>>(v2MetaDbTokens.db);
      const dataDb = container.resolve<Kysely<UnknownPostgresDatabase>>(v2DataDbTokens.db);
      const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
      const domainTable = (
        await container
          .resolve<ITableRepository>(v2CoreTokens.tableRepository)
          .findOne(context, TableByIdSpec.create(TableId.create(table.id)._unsafeUnwrap()))
      )._unsafeUnwrap();

      // Fixture-only administration: install the real index/config without enabling
      // management in the application or registering its publishers and workers.
      await ensureTableQueryOpsSchema(
        container.resolve<Kysely<TableQueryOpsDatabase>>(v2MetaDbTokens.db)
      );
      fixtureSchemaReady = true;
      await ensureTableQueryObservationSchema(
        container.resolve<Kysely<TableQueryObservationDatabase>>(v2MetaDbTokens.db)
      );
      await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(dataDb);
      const reconciled = await new PostgresTableSearchVectorReconciler(metaDb, dataDb).reconcile(
        context,
        {
          table: domainTable,
          mode: 'create',
          provider: 'pg_trgm',
          searchProbe: 'needleunique',
          validationMode: 'real_ddl',
          // A three-row fixture need not win the planner cost comparison.
          requirePlanImprovement: false,
        }
      );
      const provisioned = reconciled._unsafeUnwrap();
      expect(provisioned).toMatchObject({ action: 'created', status: 'ready' });
      const physicalIndex = await sql<{ generated: string; valid: boolean }>`
        SELECT a.attgenerated AS generated, i.indisvalid AS valid
        FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE idx.relname = ${provisioned.indexName}
          AND a.attname = ${provisioned.generatedColumnName}
      `.execute(dataDb);
      expect(physicalIndex.rows).toEqual([{ generated: 's', valid: true }]);

      const observations = async () =>
        (
          await sql`SELECT * FROM table_query_observation_shard WHERE table_id = ${table.id}`.execute(
            metaDb
          )
        ).rows;
      expect(await observations()).toEqual([]);
      // Pass-through trace recording observes the actual repository execution;
      // neither the resolver nor its returned access path is mocked.
      const spans = vi.spyOn(OpenTelemetryTracer.prototype, 'startSpan');
      const queries = vi.spyOn(Client.prototype, 'query');
      try {
        const expectedIds = table.records
          .slice(0, 2)
          .map((record) => record.id)
          .sort();
        for (const mode of ['auto', 'off'] as const) {
          runtimeMode = mode;
          const expectedPath = mode === 'auto' ? 'generated_text_trigram' : 'default_ilike';
          // Case variants preserve substring matches but use different aggregation cache keys,
          // so both modes execute SQL even when the host enables the performance cache.
          const searchValue = mode === 'auto' ? 'needleunique' : 'NEEDLEUNIQUE';

          spans.mockClear();
          const records = await getRecords(table.id, { search: [searchValue, '', true] });
          expect(records.records.map((record) => record.id).sort()).toEqual(expectedIds);
          expect(spans).toHaveBeenCalledWith(
            'teable.table.query.db.records',
            expect.objectContaining({
              'teable.table_id': table.id,
              'teable.search.access_path': expectedPath,
            })
          );

          spans.mockClear();
          const count = await getSearchCount(table.id, {
            viewId: table.views[0].id,
            search: [searchValue, '', true],
          });
          expect(count.data.count).toBe(2);
          expect(spans).toHaveBeenCalledWith(
            'teable.table.query.db.count',
            expect.objectContaining({
              'teable.table_id': table.id,
              'teable.search.access_path': expectedPath,
            })
          );

          spans.mockClear();
          const hits = await getSearchIndex(table.id, {
            take: 100,
            viewId: table.views[0].id,
            search: [searchValue, '', true],
          });
          expect([...new Set(hits.data.map((hit) => hit.recordId))].sort()).toEqual(expectedIds);
          expect(spans).toHaveBeenCalledWith(
            'teable.table.query.db.records',
            expect.objectContaining({
              'teable.table_id': table.id,
              'teable.search.access_path': expectedPath,
            })
          );
        }
        const requestSql = queries.mock.calls.map(([query]) =>
          typeof query === 'string' ? query : query.text
        );
        expect(requestSql.join('\n')).not.toMatch(
          /table_query_search_vector_config|pg_index|pg_attribute|\bEXPLAIN\b/i
        );

        // Drain any accidentally registered publisher before asserting durable
        // state, so a buffered write cannot make this check falsely pass.
        const observationRuntime = await app.get(TableQueryObservationRuntimeService).get();
        if (observationRuntime?.publisher instanceof BufferedTableQueryObservationPublisher) {
          await observationRuntime.publisher.flush();
        }
        await disposeTableQueryObservationPublisher(container);
        expect(await observations()).toEqual([]);
      } finally {
        spans.mockRestore();
        queries.mockRestore();
        runtimeMode = 'auto';
      }
    }, 120_000);
  }
);
