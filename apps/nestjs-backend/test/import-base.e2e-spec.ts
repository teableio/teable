/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentItem, IConditionalRollupFieldOptions, IFilter } from '@teable/core';
import { Colors, FieldKeyType, FieldType, Relationship, SortFunc, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IImportBaseProgressEvent,
  IImportBaseSSEEvent,
  INotifyVo,
  ITableFullVo,
  IV2SchemaIntegrityCheckResult,
} from '@teable/openapi';
import {
  createField,
  getFields,
  installViewPlugin,
  exportBase,
  importBase,
  getTableList,
  createBase,
  createDashboard,
  installPlugin,
  createPluginPanel,
  installPluginPanel,
  getDashboardList,
  getDashboard,
  listPluginPanels,
  getPluginPanel,
  getPluginPanelPlugin,
  getViewList,
  createBaseNode,
  getBaseNodeTree,
  moveBaseNode,
  BaseNodeResourceType,
  IMPORT_BASE_STREAM,
  createSpace,
  permanentDeleteSpace,
  getV2SchemaIntegrityDecision,
  updateSetting,
  SettingKey,
} from '@teable/openapi';
import { pick } from 'lodash';
import type { ClsStore } from 'nestjs-cls';
import { ClsService } from 'nestjs-cls';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { AttachmentsService } from '../src/features/attachments/attachments.service';
import { replaceStringByMap } from '../src/features/base/utils';
import { IntegrityV2Service } from '../src/features/integrity/integrity-v2.service';
import { PersistedComputedBackfillService } from '../src/features/record/computed/services/persisted-computed-backfill.service';
import type { IClsStore } from '../src/types/cls';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import { createAwaitWithEventWithResult } from './utils/event-promise';

import {
  createTable,
  permanentDeleteTable,
  initApp,
  getViews,
  getTable,
  permanentDeleteBase,
  getRecords,
  getRecord,
  deleteField,
  convertField,
  updateRecord,
  createRecords,
  runWithTestUser,
} from './utils/init-app';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForComputedRecord(
  tableId: string,
  recordId: string,
  fieldIds: string[],
  timeoutMs = 8000
) {
  const start = Date.now();
  let latestRecord = await getRecord(tableId, recordId);
  while (Date.now() - start < timeoutMs) {
    const hasAllValues = fieldIds.every((fieldId) => latestRecord.fields?.[fieldId] !== undefined);
    if (hasAllValues) {
      return latestRecord;
    }
    await sleep(200);
    latestRecord = await getRecord(tableId, recordId);
  }
  return latestRecord;
}

async function waitForRecordWithFieldValue(
  tableId: string,
  fieldId: string,
  expectedValue: unknown,
  timeoutMs = 8000
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const records = await getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
    });
    const matched = records.records.find((record) => record.fields?.[fieldId] === expectedValue);
    if (matched) {
      return matched;
    }
    await sleep(200);
  }
  return undefined;
}

async function waitForFieldHasError(tableId: string, fieldId: string) {
  const timeoutMs = 8000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const fields = (await getFields(tableId)).data;
    const field = fields.find((f) => f.id === fieldId);
    if (field?.hasError) {
      return field;
    }
    await sleep(200);
  }
  return undefined;
}

function getAttachmentService(app: INestApplication) {
  return app.get<AttachmentsService>(AttachmentsService);
}

async function importBaseViaSseStream(
  appUrl: string,
  cookie: string,
  spaceId: string,
  notify: INotifyVo
) {
  const response = await fetch(`${appUrl}/api${IMPORT_BASE_STREAM}`, {
    method: 'POST',
    headers: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Cookie: cookie,
    },
    body: JSON.stringify({
      notify,
      spaceId,
    }),
  });

  expect(response.ok).toBe(true);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const progressEvents: IImportBaseProgressEvent[] = [];
  let doneEvent: Extract<IImportBaseSSEEvent, { type: 'done' }> | null = null;
  let errorEvent: Extract<IImportBaseSSEEvent, { type: 'error' }> | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      const event = JSON.parse(jsonStr) as IImportBaseSSEEvent;
      if (event.type === 'progress') {
        progressEvents.push(event);
      } else if (event.type === 'done') {
        doneEvent = event;
      } else if (event.type === 'error') {
        errorEvent = event;
      }
    }
  }

  return { progressEvents, doneEvent, errorEvent };
}

describe('OpenAPI BaseController for base import (e2e)', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let sourceBaseId: string;
  const spaceId = globalThis.testConfig.spaceId;
  const userId = globalThis.testConfig.userId;
  let eventEmitterService: EventEmitterService;
  let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<{ previewUrl: string }>;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    cookie = appCtx.cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('export table and import the table', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;

    // let duplicateTableData: IDuplicateTableVo;
    beforeAll(async () => {
      const sourceBase = (
        await createBase({
          name: 'source_base',
          spaceId: spaceId,
          icon: '😄',
        })
      ).data;
      sourceBaseId = sourceBase.id;
      table = await createTable(sourceBase.id, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(sourceBaseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });
      eventEmitterService = app.get(EventEmitterService);

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      awaitWithEvent = createAwaitWithEventWithResult<{ previewUrl: string }>(
        eventEmitterService,
        Events.BASE_EXPORT_COMPLETE
      );

      // dashboard init
      const dashboard = (await createDashboard(sourceBaseId, { name: 'dashboard' })).data;
      const dashboard2 = (await createDashboard(sourceBaseId, { name: 'dashboard2' })).data;

      await installPlugin(sourceBaseId, dashboard.id, {
        name: 'plugin1',
        pluginId: 'plgchart',
      });

      await installPlugin(sourceBaseId, dashboard.id, {
        name: 'plugin2',
        pluginId: 'plgchart',
      });

      await installPlugin(sourceBaseId, dashboard2.id, {
        name: 'plugin2_1',
        pluginId: 'plgchart',
      });

      // pluginViews init
      await installViewPlugin(table.id, { name: 'sheetView1', pluginId: 'plgsheetform' });
      await installViewPlugin(table.id, { name: 'sheetView2', pluginId: 'plgsheetform' });

      // pluginPanel init
      const panel = (await createPluginPanel(table.id, { name: 'panel1' })).data;
      const panel2 = (await createPluginPanel(table.id, { name: 'panel2' })).data;

      await installPluginPanel(table.id, panel.id, {
        name: 'plugin1',
        pluginId: 'plgchart',
      });

      await installPluginPanel(table.id, panel.id, {
        name: 'plugin2',
        pluginId: 'plgchart',
      });

      await installPluginPanel(table.id, panel2.id, {
        name: 'plugin2_1',
        pluginId: 'plgchart',
      });

      table.fields = (await getFields(table.id)).data;
      table.views = await getViews(table.id);
      subTable.fields = (await getFields(subTable.id)).data;
      subTable.views = await getViews(subTable.id);
    });
    afterAll(async () => {
      await permanentDeleteTable(sourceBaseId, table.id);
      await permanentDeleteTable(sourceBaseId, subTable.id);
    });
    it('should export table and import the table', async () => {
      const { previewUrl: url } = await awaitWithEvent(async () => {
        await exportBase(sourceBaseId);
      });
      const previewUrl = appUrl + url;

      const clsService = app.get(ClsService);

      const attachmentService = getAttachmentService(app);

      const notify = await clsService.runWith<Promise<IAttachmentItem>>(
        {
          // eslint-disable-next-line
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await attachmentService.uploadFromUrl(previewUrl);
        }
      );

      const { base, tableIdMap, viewIdMap, fieldIdMap } = (
        await importBase({
          notify: {
            ...(notify as unknown as INotifyVo),
          },
          spaceId: spaceId,
        })
      ).data;

      expect(base.spaceId).toBe(spaceId);

      const tableList = (await getTableList(base.id)).data;

      expect(tableList.length).toBe(2);

      const table1 = await getTable(base.id, tableList[0].id, {
        includeContent: true,
      });
      const table2 = await getTable(base.id, tableList[1].id, {
        includeContent: true,
      });

      const table1Fields = table1.fields!;
      const table2Fields = table2.fields!;

      const table1Views = table1.views!;
      const table2Views = table2.views!;

      // fields
      expect(table1Fields.length).toBe(table.fields.length);
      expect(table2Fields.length).toBe(subTable.fields.length);
      const testFieldProperties = [
        'cellValueType',
        'dbFieldName',
        'dbFieldType',
        'description',
        'isLookup',
        'isPrimary',
        'name',
        'unique',
        'notNull',
        'type',
      ];

      const duplicatedTable1Fields = table1Fields.map((field) => pick(field, testFieldProperties));
      const duplicatedTable2Fields = table2Fields.map((field) => pick(field, testFieldProperties));

      const sourceTable1Fields = table.fields.map((field) => pick(field, testFieldProperties));
      const sourceTable2Fields = subTable.fields.map((field) => pick(field, testFieldProperties));

      expect(duplicatedTable1Fields).toEqual(sourceTable1Fields);
      expect(duplicatedTable2Fields).toEqual(sourceTable2Fields);

      const testViewProperties = [
        'id',
        'columnMeta',
        'filter',
        'sort',
        'group',
        'options',
        'pluginInstall',
        'order',
      ];

      const duplicatedTable1Views = table1Views.map((view) => pick(view, testViewProperties));
      const duplicatedTable2Views = table2Views.map((view) => pick(view, testViewProperties));

      const sourceTable1Views = table.views
        .map((view) => pick(view, testViewProperties))
        .map((v) => {
          const res = replaceStringByMap(v, {
            tableIdMap,
            viewIdMap,
            fieldIdMap,
          });
          return res ? JSON.parse(res) : v;
        });
      const sourceTable2Views = subTable.views
        .map((view) => pick(view, testViewProperties))
        .map((v) => {
          const res = replaceStringByMap(v, {
            tableIdMap,
            viewIdMap,
            fieldIdMap,
          });
          return res ? JSON.parse(res) : v;
        });

      // views
      expect(table1Views.length).toBe(table.views.length);
      expect(table2Views.length).toBe(subTable.views.length);

      expect(duplicatedTable1Views).toEqual(sourceTable1Views);
      expect(duplicatedTable2Views).toEqual(sourceTable2Views);

      // plugins
      // dashboard
      const sourceDashboardList = (await getDashboardList(sourceBaseId)).data;
      const dashboardList = (await getDashboardList(base.id)).data;
      expect(dashboardList.length).toBe(sourceDashboardList.length);
      expect(sourceDashboardList.map((d) => d.name)).toEqual(dashboardList.map((d) => d.name));

      const sourceDashboard1Info = (await getDashboard(sourceBaseId, sourceDashboardList[0].id))
        .data;
      const dashboard1Info = (await getDashboard(base.id, dashboardList[0].id)).data;

      const sourceDashboard2Info = (await getDashboard(sourceBaseId, sourceDashboardList[1].id))
        .data;
      const dashboard2Info = (await getDashboard(base.id, dashboardList[1].id)).data;

      const layoutProperties = ['h', 'w', 'x', 'y'];

      expect(sourceDashboard1Info.layout?.map((l) => pick(l, layoutProperties))).toEqual(
        dashboard1Info.layout?.map((l) => pick(l, layoutProperties))
      );

      expect(sourceDashboard2Info.layout?.map((l) => pick(l, layoutProperties))).toEqual(
        dashboard2Info.layout?.map((l) => pick(l, layoutProperties))
      );

      // panel
      const panelList = (await listPluginPanels(table.id)).data;

      const panel1Info = (
        await getPluginPanel(table.id, panelList.find(({ name }) => name === 'panel1')!.id)
      ).data;

      const installedPlugins = (
        await getPluginPanelPlugin(
          table.id,
          panelList.find(({ name }) => name === 'panel1')!.id,
          panel1Info.layout![0].pluginInstallId
        )
      ).data;

      expect(installedPlugins.name).toBe('plugin1');
      // pluginViews
      const views = (await getViewList(table.id)).data;

      const pluginViews = views.filter(({ type }) => type === ViewType.Plugin);
      expect(pluginViews.length).toBe(2);

      expect(pluginViews.find(({ name }) => name === 'sheetView1')).toBeDefined();
      expect(pluginViews.find(({ name }) => name === 'sheetView2')).toBeDefined();

      for (const tableId of Object.values(tableIdMap)) {
        await permanentDeleteTable(base.id, tableId);
      }
    });
  });

  describe('errored computed field import', () => {
    const lookupFieldName = 'Errored Lookup';
    const rollupFieldName = 'Errored Rollup';
    let erroredBaseId: string;
    let importedBaseId: string | undefined;
    let hostTable: ITableFullVo;
    let lookupTable: ITableFullVo;
    let awaitErroredExport: <T>(fn: () => Promise<T>) => Promise<{ previewUrl: string }>;

    beforeAll(async () => {
      const base = (
        await createBase({
          name: 'errored_computed_source',
          spaceId,
          icon: '📦',
        })
      ).data;
      erroredBaseId = base.id;

      hostTable = await createTable(erroredBaseId, {
        name: 'Errored_Host',
        fields: x_20.fields,
        records: x_20.records,
      });

      const linkTemplate = x_20_link(hostTable);
      lookupTable = await createTable(erroredBaseId, {
        name: 'Errored_Lookup',
        fields: linkTemplate.fields,
        records: linkTemplate.records,
      });

      hostTable.fields = (await getFields(hostTable.id)).data;
      lookupTable.fields = (await getFields(lookupTable.id)).data;

      const linkField = lookupTable.fields.find((field) => field.type === FieldType.Link)!;
      const hostNumberField = hostTable.fields.find((field) => field.type === FieldType.Number)!;

      const lookupField = (
        await createField(lookupTable.id, {
          name: lookupFieldName,
          type: hostNumberField.type,
          isLookup: true,
          lookupOptions: {
            foreignTableId: hostTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: hostNumberField.id,
          },
        })
      ).data;

      const rollupField = (
        await createField(lookupTable.id, {
          name: rollupFieldName,
          type: FieldType.Rollup,
          options: {
            expression: 'count({values})',
          },
          lookupOptions: {
            foreignTableId: hostTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: hostNumberField.id,
          },
        })
      ).data;

      await deleteField(hostTable.id, hostNumberField.id);

      const erroredLookup = await waitForFieldHasError(lookupTable.id, lookupField.id);
      const erroredRollup = await waitForFieldHasError(lookupTable.id, rollupField.id);
      expect(erroredLookup?.hasError).toBe(true);
      expect(erroredRollup?.hasError).toBe(true);

      lookupTable.fields = (await getFields(lookupTable.id)).data;

      awaitErroredExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
    });

    afterAll(async () => {
      if (importedBaseId) {
        await permanentDeleteBase(importedBaseId);
      }
      if (erroredBaseId) {
        await permanentDeleteBase(erroredBaseId);
      }
    });

    it('converts errored lookup and rollup fields to text on import', async () => {
      const { previewUrl } = await awaitErroredExport(async () => {
        await exportBase(erroredBaseId);
      });

      const attachmentService = getAttachmentService(app);
      const uploadClsService = app.get(ClsService);

      const notify = await uploadClsService.runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await attachmentService.uploadFromUrl(appUrl + previewUrl);
        }
      );

      const { base: importedBase } = (
        await importBase({
          notify: notify as unknown as INotifyVo,
          spaceId,
        })
      ).data;

      importedBaseId = importedBase.id;

      const tableList = (await getTableList(importedBase.id)).data;
      expect(tableList.map(({ name }) => name).sort()).toEqual(
        [hostTable.name, lookupTable.name].sort()
      );

      const importedLookupMeta = tableList.find(
        (tableMeta) => tableMeta.name === lookupTable.name
      )!;
      const importedLookupTable = await getTable(importedBase.id, importedLookupMeta.id, {
        includeContent: true,
      });

      const importedFields = importedLookupTable.fields ?? [];

      const importedLookupField = importedFields.find((field) => field.name === lookupFieldName)!;
      expect(importedLookupField.type).toBe(FieldType.SingleLineText);
      expect(importedLookupField.isLookup).toBeFalsy();
      expect(importedLookupField.lookupOptions).toBeFalsy();
      expect(importedLookupField.hasError).toBeFalsy();

      const importedRollupField = importedFields.find((field) => field.name === rollupFieldName)!;
      expect(importedRollupField.type).toBe(FieldType.SingleLineText);
      expect(importedRollupField.lookupOptions).toBeFalsy();
      expect(importedRollupField.hasError).toBeFalsy();
      expect(importedRollupField.isLookup).toBeFalsy();
    });
  });

  describe('conditional rollup import', () => {
    let conditionalBaseId: string;
    let importedBaseId: string | undefined;
    let foreignTable: ITableFullVo;
    let hostTable: ITableFullVo;
    let awaitConditionalExport: <T>(fn: () => Promise<T>) => Promise<{ previewUrl: string }>;

    beforeAll(async () => {
      const base = (
        await createBase({
          name: 'conditional_rollup_source',
          spaceId,
          icon: '🧮',
        })
      ).data;
      conditionalBaseId = base.id;

      foreignTable = await createTable(conditionalBaseId, {
        name: 'CR_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Status', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Title: 'Alpha', Status: 'Active' } },
          { fields: { Title: 'Beta', Status: 'Inactive' } },
        ],
      });

      hostTable = await createTable(conditionalBaseId, {
        name: 'CR_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText }],
        records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Inactive' } }],
      });

      const titleFieldId = foreignTable.fields.find((field) => field.name === 'Title')!.id;
      const statusFieldId = foreignTable.fields.find((field) => field.name === 'Status')!.id;
      const statusFilterFieldId = hostTable.fields.find(
        (field) => field.name === 'StatusFilter'
      )!.id;

      const statusMatchFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: statusFilterFieldId },
          },
        ],
      };

      await createField(hostTable.id, {
        name: 'Status Rollup',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreignTable.id,
          lookupFieldId: titleFieldId,
          expression: 'array_join({values})',
          filter: statusMatchFilter,
        } as IConditionalRollupFieldOptions,
      });

      await createField(hostTable.id, {
        name: 'Status Lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          lookupFieldId: titleFieldId,
          filter: statusMatchFilter,
          sort: { fieldId: titleFieldId, order: SortFunc.Asc },
          limit: 1,
        },
      });

      awaitConditionalExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
    });

    afterAll(async () => {
      if (importedBaseId) {
        await permanentDeleteBase(importedBaseId);
      }
      if (conditionalBaseId) {
        await permanentDeleteBase(conditionalBaseId);
      }
    });

    it('imports base with conditional rollup without circular dependency', async () => {
      const { previewUrl } = await awaitConditionalExport(async () => {
        await exportBase(conditionalBaseId);
      });

      const attachmentService = getAttachmentService(app);
      const clsService = app.get(ClsService);

      const notify = await clsService.runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await attachmentService.uploadFromUrl(appUrl + previewUrl);
        }
      );

      const { base: importedBase } = (
        await importBase({
          notify: notify as unknown as INotifyVo,
          spaceId,
        })
      ).data;

      importedBaseId = importedBase.id;

      const tableList = (await getTableList(importedBase.id)).data;
      expect(tableList.map(({ name }) => name).sort()).toEqual(
        [hostTable.name, foreignTable.name].sort()
      );

      const importedHostMeta = tableList.find((tableMeta) => tableMeta.name === hostTable.name)!;
      const importedHost = await getTable(importedBase.id, importedHostMeta.id, {
        includeContent: true,
      });

      const importedFields = importedHost.fields ?? [];
      const importedRollupField = importedFields.find((field) => field.name === 'Status Rollup')!;
      expect(importedRollupField.type).toBe(FieldType.ConditionalRollup);
      expect(importedRollupField.hasError).toBeFalsy();

      const importedLookupField = importedFields.find((field) => field.name === 'Status Lookup')!;
      expect(importedLookupField.isLookup).toBeTruthy();
      expect(importedLookupField.isConditionalLookup).toBeTruthy();
      expect(importedLookupField.hasError).toBeFalsy();
      const lookupOptions =
        typeof importedLookupField.lookupOptions === 'string'
          ? (JSON.parse(importedLookupField.lookupOptions) as {
              sort?: { fieldId: string; order?: SortFunc };
            })
          : (importedLookupField.lookupOptions as
              | { sort?: { fieldId: string; order?: SortFunc } }
              | undefined);
      expect(lookupOptions?.sort?.order).toBe(SortFunc.Asc);

      const importedStatusFilter = importedFields.find((field) => field.name === 'StatusFilter')!;

      const activeRecordMeta = await waitForRecordWithFieldValue(
        importedHostMeta.id,
        importedStatusFilter.id,
        'Active'
      );
      const inactiveRecordMeta = await waitForRecordWithFieldValue(
        importedHostMeta.id,
        importedStatusFilter.id,
        'Inactive'
      );

      expect(activeRecordMeta).toBeDefined();
      expect(inactiveRecordMeta).toBeDefined();

      const activeRecord = await waitForComputedRecord(importedHostMeta.id, activeRecordMeta!.id, [
        importedRollupField.id,
        importedLookupField.id,
      ]);
      const inactiveRecord = await waitForComputedRecord(
        importedHostMeta.id,
        inactiveRecordMeta!.id,
        [importedRollupField.id, importedLookupField.id]
      );

      expect(activeRecord.fields?.[importedRollupField.id]).toBe('Alpha');
      expect(inactiveRecord.fields?.[importedRollupField.id]).toBe('Beta');
      expect(activeRecord.fields?.[importedLookupField.id]).toEqual(['Alpha']);
      expect(inactiveRecord.fields?.[importedLookupField.id]).toEqual(['Beta']);
    });
  });

  describe('primary formula import', () => {
    let sourceBaseId: string | undefined;
    let importedBaseId: string | undefined;

    afterEach(async () => {
      if (importedBaseId) {
        await permanentDeleteBase(importedBaseId);
        importedBaseId = undefined;
      }
      if (sourceBaseId) {
        await permanentDeleteBase(sourceBaseId);
        sourceBaseId = undefined;
      }
    });

    it('imports base with primary formula numeric expression using generated columns', async () => {
      const sourceBase = (
        await createBase({
          name: 'primary_formula_source',
          spaceId,
          icon: '🧮',
        })
      ).data;
      sourceBaseId = sourceBase.id;

      const table = await createTable(sourceBase.id, {
        name: 'Primary Formula Table',
        fields: [
          { name: 'Primary Field', type: FieldType.SingleLineText },
          { name: 'Remaining Minutes', type: FieldType.Number },
        ],
      });

      const primaryFieldId = table.fields.find((field) => field.isPrimary)!.id;
      const remainingMinutesId = table.fields.find(
        (field) => field.name === 'Remaining Minutes'
      )!.id;

      await convertField(table.id, primaryFieldId, {
        type: FieldType.Formula,
        options: {
          expression: `({${remainingMinutesId}} * 45) / 60`,
        },
      });

      const awaitExportWithPreview = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );

      const { previewUrl } = await awaitExportWithPreview(async () => {
        await exportBase(sourceBaseId!);
      });

      const attachmentService = getAttachmentService(app);
      const clsService = app.get(ClsService);

      const notify = await clsService.runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await attachmentService.uploadFromUrl(appUrl + previewUrl);
        }
      );

      const { base: importedBase } = (
        await importBase({
          notify: notify as unknown as INotifyVo,
          spaceId,
        })
      ).data;
      importedBaseId = importedBase.id;

      const tableList = (await getTableList(importedBaseId)).data;
      expect(tableList).toHaveLength(1);

      const importedTableMeta = tableList[0];
      const importedTable = await getTable(importedBaseId, importedTableMeta.id, {
        includeContent: true,
      });

      const importedPrimaryField = importedTable.fields?.find((field) => field.isPrimary);
      expect(importedPrimaryField?.type).toBe(FieldType.Formula);

      const importedRemainingField = importedTable.fields?.find(
        (field) => field.name === 'Remaining Minutes'
      );
      expect(importedRemainingField).toBeDefined();

      const primaryOptions =
        typeof importedPrimaryField?.options === 'string'
          ? (JSON.parse(importedPrimaryField.options) as { expression?: string })
          : (importedPrimaryField?.options as { expression?: string }) ?? {};

      expect(primaryOptions.expression).toBeDefined();
      expect(primaryOptions.expression).toContain(`{${importedRemainingField!.id}}`);
      expect(importedPrimaryField?.hasError).toBeFalsy();

      const prisma = app.get(PrismaService);
      const primaryFieldRaw = await prisma.field.findUniqueOrThrow({
        where: { id: importedPrimaryField!.id },
        select: { meta: true },
      });
      const persistedMeta =
        typeof primaryFieldRaw.meta === 'string'
          ? (JSON.parse(primaryFieldRaw.meta) as { persistedAsGeneratedColumn?: boolean })
          : primaryFieldRaw.meta ?? {};
      expect(persistedMeta?.persistedAsGeneratedColumn).not.toBe(true);
    });
  });

  describe('canary base import', () => {
    let canarySpaceId: string | undefined;
    let canarySourceBaseId: string | undefined;
    let importedCanaryBaseId: string | undefined;
    let importedCanaryStreamBaseId: string | undefined;

    const createCanarySpace = async (name: string) => {
      const space = await createSpace({ name });
      canarySpaceId = space.data.id;

      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [canarySpaceId],
        },
      });

      return space.data;
    };

    const uploadExportedBase = async (baseId: string) => {
      const awaitExportWithPreview = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
      const { previewUrl } = await awaitExportWithPreview(async () => {
        await exportBase(baseId);
      });

      return await app.get(ClsService).runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await getAttachmentService(app).uploadFromUrl(appUrl + previewUrl);
        }
      );
    };

    const importExportedBaseViaSse = async (baseId: string) => {
      const notify = await uploadExportedBase(baseId);
      const { progressEvents, doneEvent, errorEvent } = await importBaseViaSseStream(
        appUrl,
        cookie,
        canarySpaceId!,
        notify as unknown as INotifyVo
      );

      expect(errorEvent).toBeNull();
      expect(doneEvent).not.toBeNull();
      importedCanaryStreamBaseId = doneEvent!.data.base.id;

      return { progressEvents, result: doneEvent!.data };
    };

    afterEach(async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: false,
          spaceIds: [],
        },
      });

      if (importedCanaryStreamBaseId) {
        await permanentDeleteBase(importedCanaryStreamBaseId);
        importedCanaryStreamBaseId = undefined;
      }
      if (importedCanaryBaseId) {
        await permanentDeleteBase(importedCanaryBaseId);
        importedCanaryBaseId = undefined;
      }
      if (canarySourceBaseId) {
        await permanentDeleteBase(canarySourceBaseId);
        canarySourceBaseId = undefined;
      }
      if (canarySpaceId) {
        await permanentDeleteSpace(canarySpaceId);
        canarySpaceId = undefined;
      }
    });

    it('keeps v2 schema integrity clean for computed fields after importing into a canary space', async () => {
      const space = await createSpace({ name: 'canary_import_space' });
      canarySpaceId = space.data.id;

      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [canarySpaceId],
        },
      });

      const sourceBase = (
        await createBase({
          name: 'canary_formula_source',
          spaceId: canarySpaceId,
          icon: '🧪',
        })
      ).data;
      canarySourceBaseId = sourceBase.id;

      const table = await createTable(sourceBase.id, {
        name: 'Formula Table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Minutes', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'Row 1', Minutes: 2 } },
          { fields: { Name: 'Row 2', Minutes: 4 } },
        ],
      });

      const minutesField = table.fields.find((field) => field.name === 'Minutes')!;
      await createField(table.id, {
        name: 'Hours',
        type: FieldType.Formula,
        options: {
          expression: `{${minutesField.id}} / 2`,
        },
      });

      const awaitExportWithPreview = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );

      const { previewUrl } = await awaitExportWithPreview(async () => {
        await exportBase(canarySourceBaseId!);
      });

      const attachmentService = getAttachmentService(app);
      const clsService = app.get(ClsService);

      const notify = await clsService.runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await attachmentService.uploadFromUrl(appUrl + previewUrl);
        }
      );

      const { base: importedBase } = (
        await importBase({
          notify: notify as unknown as INotifyVo,
          spaceId: canarySpaceId,
        })
      ).data;
      const importedBaseId = importedBase.id;
      importedCanaryBaseId = importedBaseId;

      const integrityDecision = await getV2SchemaIntegrityDecision(importedBaseId);
      expect(integrityDecision.data.useV2).toBe(true);

      const integrityV2Service = app.get(IntegrityV2Service);
      const integrityResults: IV2SchemaIntegrityCheckResult[] = [];
      const integrityClsService = app.get<ClsService<IClsStore>>(ClsService);
      await runWithTestUser(integrityClsService, async () => {
        const integrityStream = await integrityV2Service.createBaseCheckStream(importedBaseId, [
          'warn',
          'error',
        ]);
        for await (const result of integrityStream) {
          integrityResults.push(result);
        }
      });

      expect(integrityResults).toEqual([]);

      const importedTableMeta = (await getTableList(importedCanaryBaseId)).data.find(
        (item) => item.name === 'Formula Table'
      )!;
      const importedTable = await getTable(importedCanaryBaseId, importedTableMeta.id, {
        includeContent: true,
      });
      const importedHoursField = importedTable.fields?.find((field) => field.name === 'Hours');
      expect(importedHoursField).toBeDefined();

      expect(
        await waitForRecordWithFieldValue(importedTableMeta.id, importedHoursField!.id, 1)
      ).toBeDefined();
      expect(
        await waitForRecordWithFieldValue(importedTableMeta.id, importedHoursField!.id, 2)
      ).toBeDefined();

      const importedRecords = await getRecords(importedTableMeta.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(
        importedRecords.records.map((record) => record.fields?.[importedHoursField!.id])
      ).toEqual([1, 2]);
    });

    it('imports a canary base through SSE stream with table and row progress', async () => {
      const space = await createSpace({ name: 'canary_stream_import_space' });
      canarySpaceId = space.data.id;

      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [canarySpaceId],
        },
      });

      const sourceBase = (
        await createBase({
          name: 'canary_stream_source',
          spaceId: canarySpaceId,
          icon: '🔄',
        })
      ).data;
      canarySourceBaseId = sourceBase.id;

      const sourceTable = await createTable(sourceBase.id, {
        name: 'Canary Stream Rows',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Tags',
            type: FieldType.MultipleSelect,
            options: {
              choices: [
                { id: 'choRap', name: 'rap', color: Colors.Cyan },
                { id: 'choRock', name: 'rock', color: Colors.Blue },
              ],
            },
          },
          { name: 'Minutes', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'Alpha', Tags: ['rap', 'rock'], Minutes: 2 } },
          { fields: { Name: 'Beta', Tags: ['rock'], Minutes: 4 } },
        ],
      });

      const minutesField = sourceTable.fields.find((field) => field.name === 'Minutes')!;
      await createField(sourceTable.id, {
        name: 'Hours',
        type: FieldType.Formula,
        options: {
          expression: `{${minutesField.id}} / 2`,
        },
      });

      const folderNode = await createBaseNode(sourceBase.id, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Imported Folder',
      }).then((res) => res.data);
      const sourceNodeTree = await getBaseNodeTree(sourceBase.id).then((res) => res.data);
      const sourceTableNode = sourceNodeTree.nodes.find(
        (node) =>
          node.resourceType === BaseNodeResourceType.Table && node.resourceId === sourceTable.id
      );
      expect(sourceTableNode).toBeDefined();
      await moveBaseNode(sourceBase.id, sourceTableNode!.id, { parentId: folderNode.id });

      const awaitExportWithPreview = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
      const { previewUrl } = await awaitExportWithPreview(async () => {
        await exportBase(canarySourceBaseId!);
      });

      const notify = await app.get(ClsService).runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await getAttachmentService(app).uploadFromUrl(appUrl + previewUrl);
        }
      );

      const { progressEvents, doneEvent, errorEvent } = await importBaseViaSseStream(
        appUrl,
        cookie,
        canarySpaceId,
        notify as unknown as INotifyVo
      );

      expect(errorEvent).toBeNull();
      expect(doneEvent).not.toBeNull();

      const result = doneEvent!.data;
      importedCanaryStreamBaseId = result.base.id;
      expect(result.base.spaceId).toBe(canarySpaceId);

      const integrityDecision = await getV2SchemaIntegrityDecision(importedCanaryStreamBaseId);
      expect(integrityDecision.data.useV2).toBe(true);

      const phases = progressEvents.map((event) => event.phase);
      expect(phases).toContain('table_structure_started');
      expect(phases).toContain('table_structure_validating');
      expect(phases).toContain('table_structure_committing');
      expect(phases).toContain('table_structure_done');
      expect(phases).toContain('restoring_base_nodes');
      expect(phases).toContain('table_data_progress');
      expect(phases).toContain('table_data_done');
      expect(phases).not.toContain('computed_backfill');
      expect(phases).not.toContain('computed_backfill_failed');

      const tableStructureDone = progressEvents.find(
        (event) =>
          event.phase === 'table_structure_done' && event.tableName === 'Canary Stream Rows'
      );
      expect(tableStructureDone).toMatchObject({
        tableIndex: 1,
        totalTables: 1,
      });

      const tableDataDone = progressEvents.find(
        (event) => event.phase === 'table_data_done' && event.tableName === 'Canary Stream Rows'
      );
      expect(tableDataDone).toMatchObject({
        processedRows: 2,
      });

      const tableDataProgress = progressEvents.find(
        (event) => event.phase === 'table_data_progress' && event.tableName === 'Canary Stream Rows'
      );
      expect(tableDataProgress).toMatchObject({
        processedRows: 2,
        batchProcessedRows: 2,
        currentBatch: 1,
      });

      const tables = (await getTableList(importedCanaryStreamBaseId)).data;
      expect(tables).toHaveLength(1);
      const importedTableMeta = tables[0];
      expect(importedTableMeta.name).toBe('Canary Stream Rows');

      const importedNodeTree = await getBaseNodeTree(importedCanaryStreamBaseId).then(
        (res) => res.data
      );
      const importedFolderNode = importedNodeTree.nodes.find(
        (node) =>
          node.resourceType === BaseNodeResourceType.Folder &&
          node.resourceMeta?.name === folderNode.resourceMeta?.name
      );
      expect(importedFolderNode).toBeDefined();
      const importedTableNode = importedNodeTree.nodes.find(
        (node) =>
          node.resourceType === BaseNodeResourceType.Table &&
          node.resourceId === importedTableMeta.id
      );
      expect(importedTableNode?.parentId).toBe(importedFolderNode!.id);

      const importedTable = await getTable(importedCanaryStreamBaseId, importedTableMeta.id, {
        includeContent: true,
      });
      const importedHoursField = importedTable.fields?.find((field) => field.name === 'Hours');
      expect(importedHoursField?.type).toBe(FieldType.Formula);

      let importedRecords = await getRecords(importedTableMeta.id, {
        fieldKeyType: FieldKeyType.Name,
      });
      expect(importedRecords.records).toHaveLength(2);

      const alpha = importedRecords.records.find((record) => record.fields?.Name === 'Alpha');
      const beta = importedRecords.records.find((record) => record.fields?.Name === 'Beta');
      expect(alpha?.fields?.Tags).toEqual(['rap', 'rock']);
      expect(beta?.fields?.Tags).toEqual(['rock']);
      const alphaWithComputed = await waitForRecordWithFieldValue(
        importedTableMeta.id,
        importedHoursField!.id,
        1
      );
      importedRecords = await getRecords(importedTableMeta.id, {
        fieldKeyType: FieldKeyType.Name,
      });
      const betaWithComputed = importedRecords.records.find(
        (record) => record.fields?.Name === 'Beta'
      );
      expect(alphaWithComputed?.fields?.[importedHoursField!.id]).toBe(1);
      expect(betaWithComputed?.fields?.Hours).toBe(2);
    });

    it('does not invoke legacy computed backfill during canary SSE import', async () => {
      const space = await createSpace({ name: 'canary_stream_no_legacy_backfill_space' });
      canarySpaceId = space.data.id;

      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [canarySpaceId],
        },
      });

      const sourceBase = (
        await createBase({
          name: 'canary_no_legacy_backfill_source',
          spaceId: canarySpaceId,
        })
      ).data;
      canarySourceBaseId = sourceBase.id;

      await createTable(sourceBase.id, {
        name: 'No Legacy Backfill Rows',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Alpha' } }],
      });

      const awaitExportWithPreview = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
      const { previewUrl } = await awaitExportWithPreview(async () => {
        await exportBase(canarySourceBaseId!);
      });

      const notify = await app.get(ClsService).runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await getAttachmentService(app).uploadFromUrl(appUrl + previewUrl);
        }
      );

      const backfillService = app.get(PersistedComputedBackfillService);
      const backfillSpy = vi.spyOn(backfillService, 'recomputeForTables');

      try {
        const { progressEvents, doneEvent, errorEvent } = await importBaseViaSseStream(
          appUrl,
          cookie,
          canarySpaceId,
          notify as unknown as INotifyVo
        );

        expect(errorEvent).toBeNull();
        expect(doneEvent).not.toBeNull();
        importedCanaryStreamBaseId = doneEvent!.data.base.id;

        expect(progressEvents.map((event) => event.phase)).not.toContain('computed_backfill');
        expect(progressEvents.map((event) => event.phase)).not.toContain(
          'computed_backfill_failed'
        );
        expect(backfillSpy).not.toHaveBeenCalled();
      } finally {
        backfillSpy.mockRestore();
      }
    });

    it('imports table views, dashboards, panels and plugin views through canary SSE', async () => {
      const space = await createCanarySpace('canary_full_import_space');
      const sourceBase = (
        await createBase({
          name: 'canary_full_source',
          spaceId: space.id,
          icon: '😄',
        })
      ).data;
      canarySourceBaseId = sourceBase.id;

      const mainTable = await createTable(sourceBase.id, {
        name: 'canary_record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });
      const x20Link = x_20_link(mainTable);
      const subTable = await createTable(sourceBase.id, {
        name: 'canary_lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const lookupFields = x_20_link_from_lookups(mainTable, subTable.fields[2].id).fields;
      for (const field of lookupFields) {
        await createField(subTable.id, field);
      }

      const dashboard = (await createDashboard(sourceBase.id, { name: 'dashboard' })).data;
      await installPlugin(sourceBase.id, dashboard.id, {
        name: 'dashboard plugin',
        pluginId: 'plgchart',
      });

      await installViewPlugin(mainTable.id, { name: 'sheetView1', pluginId: 'plgsheetform' });
      await installViewPlugin(mainTable.id, { name: 'sheetView2', pluginId: 'plgsheetform' });

      const panel = (await createPluginPanel(mainTable.id, { name: 'panel1' })).data;
      await installPluginPanel(mainTable.id, panel.id, {
        name: 'panel plugin',
        pluginId: 'plgchart',
      });

      const { result } = await importExportedBaseViaSse(sourceBase.id);
      const importedBaseId = result.base.id;

      const tableList = (await getTableList(importedBaseId)).data;
      expect(tableList.map((table) => table.name).sort()).toEqual(
        [mainTable.name, subTable.name].sort()
      );

      const importedMainTable = tableList.find((table) => table.name === mainTable.name)!;
      const importedFields = (await getFields(importedMainTable.id)).data;
      expect(importedFields.length).toBe((await getFields(mainTable.id)).data.length);

      const importedViews = (await getViewList(importedMainTable.id)).data;
      const importedPluginViews = importedViews.filter((view) => view.type === ViewType.Plugin);
      expect(importedPluginViews.map((view) => view.name).sort()).toEqual(
        ['sheetView1', 'sheetView2'].sort()
      );

      const importedDashboards = (await getDashboardList(importedBaseId)).data;
      expect(importedDashboards.map((item) => item.name)).toEqual(['dashboard']);

      const importedPanels = (await listPluginPanels(importedMainTable.id)).data;
      expect(importedPanels.map((item) => item.name)).toEqual(['panel1']);
    });

    it('converts errored lookup and rollup fields to text through canary SSE', async () => {
      const space = await createCanarySpace('canary_errored_computed_space');
      const sourceBase = (
        await createBase({
          name: 'canary_errored_computed_source',
          spaceId: space.id,
        })
      ).data;
      canarySourceBaseId = sourceBase.id;

      const hostTable = await createTable(sourceBase.id, {
        name: 'Canary_Errored_Host',
        fields: x_20.fields,
        records: x_20.records,
      });
      const x20Link = x_20_link(hostTable);
      const lookupTable = await createTable(sourceBase.id, {
        name: 'Canary_Errored_Lookup',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const linkField = (await getFields(lookupTable.id)).data.find(
        (field) => field.type === FieldType.Link
      )!;
      const hostNumberField = (await getFields(hostTable.id)).data.find(
        (field) => field.type === FieldType.Number
      )!;

      const lookupField = (
        await createField(lookupTable.id, {
          name: 'Errored Lookup',
          type: hostNumberField.type,
          isLookup: true,
          lookupOptions: {
            foreignTableId: hostTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: hostNumberField.id,
          },
        })
      ).data;
      const rollupField = (
        await createField(lookupTable.id, {
          name: 'Errored Rollup',
          type: FieldType.Rollup,
          options: {
            expression: 'count({values})',
          },
          lookupOptions: {
            foreignTableId: hostTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: hostNumberField.id,
          },
        })
      ).data;

      await deleteField(hostTable.id, hostNumberField.id);
      expect(await waitForFieldHasError(lookupTable.id, lookupField.id)).toBeDefined();
      expect(await waitForFieldHasError(lookupTable.id, rollupField.id)).toBeDefined();

      const { result } = await importExportedBaseViaSse(sourceBase.id);
      const importedTables = (await getTableList(result.base.id)).data;
      const importedLookupTable = importedTables.find((table) => table.name === lookupTable.name)!;
      const importedFields = (await getFields(importedLookupTable.id)).data;

      const importedLookupField = importedFields.find((field) => field.name === 'Errored Lookup')!;
      expect(importedLookupField.type).toBe(FieldType.SingleLineText);
      expect(importedLookupField.isLookup).toBeFalsy();
      expect(importedLookupField.hasError).toBeFalsy();

      const importedRollupField = importedFields.find((field) => field.name === 'Errored Rollup')!;
      expect(importedRollupField.type).toBe(FieldType.SingleLineText);
      expect(importedRollupField.isLookup).toBeFalsy();
      expect(importedRollupField.hasError).toBeFalsy();
    });

    it('imports conditional rollup and conditional lookup through canary SSE', async () => {
      const space = await createCanarySpace('canary_conditional_rollup_space');
      const sourceBase = (
        await createBase({ name: 'canary_conditional_rollup_source', spaceId: space.id })
      ).data;
      canarySourceBaseId = sourceBase.id;

      const foreignTable = await createTable(sourceBase.id, {
        name: 'Canary_CR_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Status', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Title: 'Alpha', Status: 'Active' } },
          { fields: { Title: 'Beta', Status: 'Inactive' } },
        ],
      });
      const hostTable = await createTable(sourceBase.id, {
        name: 'Canary_CR_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText }],
        records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Inactive' } }],
      });

      const titleFieldId = foreignTable.fields.find((field) => field.name === 'Title')!.id;
      const statusFieldId = foreignTable.fields.find((field) => field.name === 'Status')!.id;
      const statusFilterFieldId = hostTable.fields.find(
        (field) => field.name === 'StatusFilter'
      )!.id;
      const statusMatchFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: statusFilterFieldId },
          },
        ],
      };

      await createField(hostTable.id, {
        name: 'Status Rollup',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreignTable.id,
          lookupFieldId: titleFieldId,
          expression: 'array_join({values})',
          filter: statusMatchFilter,
        } as IConditionalRollupFieldOptions,
      });
      await createField(hostTable.id, {
        name: 'Status Lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          lookupFieldId: titleFieldId,
          filter: statusMatchFilter,
          sort: { fieldId: titleFieldId, order: SortFunc.Asc },
          limit: 1,
        },
      });

      const { result } = await importExportedBaseViaSse(sourceBase.id);
      const importedTables = (await getTableList(result.base.id)).data;
      const importedHost = importedTables.find((table) => table.name === hostTable.name)!;
      const importedFields = (await getFields(importedHost.id)).data;
      const importedRollupField = importedFields.find((field) => field.name === 'Status Rollup')!;
      const importedLookupField = importedFields.find((field) => field.name === 'Status Lookup')!;
      expect(importedRollupField.type).toBe(FieldType.ConditionalRollup);
      expect(importedLookupField.isConditionalLookup).toBeTruthy();

      const importedStatusFilter = importedFields.find((field) => field.name === 'StatusFilter')!;
      const activeRecordMeta = await waitForRecordWithFieldValue(
        importedHost.id,
        importedStatusFilter.id,
        'Active'
      );
      const activeRecord = await waitForComputedRecord(importedHost.id, activeRecordMeta!.id, [
        importedRollupField.id,
        importedLookupField.id,
      ]);
      expect(activeRecord.fields?.[importedRollupField.id]).toBe('Alpha');
      expect(activeRecord.fields?.[importedLookupField.id]).toEqual(['Alpha']);
    });

    it('imports primary formula fields through canary SSE', async () => {
      const space = await createCanarySpace('canary_primary_formula_space');
      const sourceBase = (
        await createBase({ name: 'canary_primary_formula_source', spaceId: space.id })
      ).data;
      canarySourceBaseId = sourceBase.id;

      const table = await createTable(sourceBase.id, {
        name: 'Canary Primary Formula Table',
        fields: [
          { name: 'Primary Field', type: FieldType.SingleLineText },
          { name: 'Remaining Minutes', type: FieldType.Number },
        ],
      });
      const primaryFieldId = table.fields.find((field) => field.isPrimary)!.id;
      const remainingMinutesId = table.fields.find(
        (field) => field.name === 'Remaining Minutes'
      )!.id;
      await convertField(table.id, primaryFieldId, {
        type: FieldType.Formula,
        options: {
          expression: `({${remainingMinutesId}} * 45) / 60`,
        },
      });

      const { result } = await importExportedBaseViaSse(sourceBase.id);
      const tableList = (await getTableList(result.base.id)).data;
      expect(tableList).toHaveLength(1);

      const importedTable = await getTable(result.base.id, tableList[0].id, {
        includeContent: true,
      });
      const importedPrimaryField = importedTable.fields?.find((field) => field.isPrimary);
      const importedRemainingField = importedTable.fields?.find(
        (field) => field.name === 'Remaining Minutes'
      );
      expect(importedPrimaryField?.type).toBe(FieldType.Formula);
      expect(importedRemainingField).toBeDefined();

      const primaryOptions =
        typeof importedPrimaryField?.options === 'string'
          ? (JSON.parse(importedPrimaryField.options) as { expression?: string })
          : (importedPrimaryField?.options as { expression?: string }) ?? {};
      expect(primaryOptions.expression).toContain(`{${importedRemainingField!.id}}`);
      expect(importedPrimaryField?.hasError).toBeFalsy();

      const prisma = app.get(PrismaService);
      const primaryFieldRaw = await prisma.field.findUniqueOrThrow({
        where: { id: importedPrimaryField!.id },
        select: { meta: true },
      });
      const persistedMeta =
        typeof primaryFieldRaw.meta === 'string'
          ? (JSON.parse(primaryFieldRaw.meta) as { persistedAsGeneratedColumn?: boolean })
          : primaryFieldRaw.meta ?? {};
      expect(persistedMeta?.persistedAsGeneratedColumn).not.toBe(true);
    });

    it('imports multiple link fields targeting the same table through canary SSE', async () => {
      const space = await createCanarySpace('canary_multi_link_space');
      const sourceBase = (await createBase({ name: 'canary_multi_link_source', spaceId: space.id }))
        .data;
      canarySourceBaseId = sourceBase.id;

      const foreignTable = await createTable(sourceBase.id, {
        name: 'CanarySharedTarget',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Score', type: FieldType.Number },
        ],
        records: [
          { fields: { Title: 'Target A', Score: 1.5 } },
          { fields: { Title: 'Target B', Score: 2.5 } },
        ],
      });
      const hostTable = await createTable(sourceBase.id, {
        name: 'CanaryMultiLinkHost',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Host 1' } }],
      });

      const link1Field = (
        await createField(hostTable.id, {
          name: 'Link1',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
          },
        })
      ).data;
      const link2Field = (
        await createField(hostTable.id, {
          name: 'Link2',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
          },
        })
      ).data;
      await createField(hostTable.id, {
        name: 'Link3',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
        },
      });
      await createField(hostTable.id, {
        name: 'Target Scores',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          linkFieldId: link1Field.id,
          lookupFieldId: foreignTable.fields.find((field) => field.name === 'Score')!.id,
        },
      });

      await updateRecord(hostTable.id, hostTable.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [link1Field.id]: [
              { id: foreignTable.records[0].id },
              { id: foreignTable.records[1].id },
            ],
            [link2Field.id]: [{ id: foreignTable.records[1].id }],
          },
        },
      });
      await createRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: Array.from({ length: 125 }, (_, index) => ({
          fields: {
            Name: `Batch Host ${index + 1}`,
            [link1Field.id]: [{ id: foreignTable.records[index % 2].id }],
            [link2Field.id]: [{ id: foreignTable.records[(index + 1) % 2].id }],
          },
        })),
      });

      const { progressEvents, result } = await importExportedBaseViaSse(sourceBase.id);
      const junctionTableDataProgress = progressEvents.filter(
        (event) => event.phase.startsWith('table_data_') && event.tableName?.includes('junction_')
      );
      const linkFieldProgressEvents = progressEvents.filter(
        (event) => event.phase === 'link_fields_progress'
      );
      expect(junctionTableDataProgress).toHaveLength(0);
      expect(progressEvents.map((event) => event.phase)).not.toContain('restoring_link_relations');
      expect(linkFieldProgressEvents.length).toBeGreaterThan(0);
      expect(new Set(linkFieldProgressEvents.map((event) => event.tableId))).toEqual(
        new Set(['__link_fields__'])
      );
      expect(linkFieldProgressEvents.at(-1)?.totalRows).toBeGreaterThan(0);
      expect(linkFieldProgressEvents.at(-1)?.processedRows).toBe(
        linkFieldProgressEvents.at(-1)?.totalRows
      );

      const tableList = (await getTableList(result.base.id)).data;
      expect(tableList.length).toBe(2);

      const importedHostMeta = tableList.find((table) => table.name === hostTable.name)!;
      const importedForeignMeta = tableList.find((table) => table.name === foreignTable.name)!;
      const importedHostFields = (await getFields(importedHostMeta.id)).data;
      const importedForeignFields = (await getFields(importedForeignMeta.id)).data;
      const importedTargetScoresField = importedHostFields.find(
        (field) => field.name === 'Target Scores'
      )!;

      expect(importedHostFields.filter((field) => field.type === FieldType.Link).length).toBe(3);
      const foreignDbFieldNames = importedForeignFields
        .filter((field) => field.type === FieldType.Link)
        .map((field) => field.dbFieldName);
      expect(new Set(foreignDbFieldNames).size).toBe(3);

      const importedRecords = await getRecords(importedHostMeta.id, {
        fieldKeyType: FieldKeyType.Name,
        take: 200,
      });
      const importedHostRecord = importedRecords.records.find(
        (record) => record.fields?.Name === 'Host 1'
      );
      const importedBatchHostRecord = importedRecords.records.find(
        (record) => record.fields?.Name === 'Batch Host 125'
      );
      expect(importedRecords.records.length).toBe(126);
      expect(importedHostRecord?.fields?.Link1).toMatchObject([
        { title: 'Target A' },
        { title: 'Target B' },
      ]);
      expect(importedHostRecord?.fields?.Link2).toMatchObject([{ title: 'Target B' }]);
      const computedHostRecord = await waitForComputedRecord(
        importedHostMeta.id,
        importedHostRecord!.id,
        [importedTargetScoresField.id]
      );
      expect(computedHostRecord.fields?.[importedTargetScoresField.id]).toEqual([1.5, 2.5]);
      expect(importedBatchHostRecord?.fields?.Link1).toMatchObject([{ title: 'Target A' }]);
      expect(importedBatchHostRecord?.fields?.Link2).toMatchObject([{ title: 'Target B' }]);
    }, 30_000);
  });

  describe('export and import the base with nodes [Folder, Table, Dashboard]', () => {
    let nodeBaseId: string | undefined;
    let importedNodeBaseId: string | undefined;
    let awaitNodeExport: <T>(fn: () => Promise<T>) => Promise<{ previewUrl: string }>;

    beforeAll(async () => {
      awaitNodeExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
    });

    afterAll(async () => {
      if (importedNodeBaseId) {
        await permanentDeleteBase(importedNodeBaseId);
      }
      if (nodeBaseId) {
        await permanentDeleteBase(nodeBaseId);
      }
    });

    it('should export and import base with node hierarchy correctly', async () => {
      // 1. Create source base with node hierarchy
      const sourceBase = await createBase({
        name: 'node_hierarchy_source',
        spaceId,
        icon: '📁',
      }).then((res) => res.data);
      nodeBaseId = sourceBase.id;

      // Create folders using createBaseNode
      const folder1Node = await createBaseNode(nodeBaseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder 1',
      }).then((res) => res.data);
      const folder2Node = await createBaseNode(nodeBaseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder 2',
      }).then((res) => res.data);

      // Create tables using createBaseNode
      const table1Node = await createBaseNode(nodeBaseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table 1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const table2Node = await createBaseNode(nodeBaseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table 2',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      }).then((res) => res.data);

      // Create dashboards using createBaseNode
      const dashboard1Node = await createBaseNode(nodeBaseId, {
        resourceType: BaseNodeResourceType.Dashboard,
        name: 'Dashboard 1',
      }).then((res) => res.data);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const dashboard2Node = await createBaseNode(nodeBaseId, {
        resourceType: BaseNodeResourceType.Dashboard,
        name: 'Dashboard 2',
      }).then((res) => res.data);

      // Move table1 into folder1 and dashboard1 into folder2
      await moveBaseNode(nodeBaseId, table1Node.id, { parentId: folder1Node.id });
      await moveBaseNode(nodeBaseId, dashboard1Node.id, { parentId: folder2Node.id });

      // Get updated node tree
      const updatedSourceNodeTree = await getBaseNodeTree(nodeBaseId).then((res) => res.data);
      const updatedSourceNodes = updatedSourceNodeTree.nodes;

      // 2. Export the base
      const { previewUrl } = await awaitNodeExport(async () => {
        await exportBase(nodeBaseId!);
      });

      // 3. Import the base
      const attachmentService = getAttachmentService(app);
      const clsService = app.get(ClsService);

      const notify = await clsService.runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await attachmentService.uploadFromUrl(appUrl + previewUrl);
        }
      );

      const { base: importedBase } = (
        await importBase({
          notify: notify as unknown as INotifyVo,
          spaceId,
        })
      ).data;

      importedNodeBaseId = importedBase.id;

      // 4. Verify imported node tree
      const importedNodeTree = await getBaseNodeTree(importedNodeBaseId).then((res) => res.data);
      const importedNodes = importedNodeTree.nodes;

      // Verify same number of nodes
      expect(importedNodes.length).toBe(updatedSourceNodes.length);

      // Verify resource types distribution
      const sourceResourceTypes = updatedSourceNodes
        .map((n) => n.resourceType)
        .sort()
        .join(',');
      const importedResourceTypes = importedNodes
        .map((n) => n.resourceType)
        .sort()
        .join(',');
      expect(importedResourceTypes).toBe(sourceResourceTypes);

      // Verify folder count
      const sourceFolders = updatedSourceNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Folder
      );
      const importedFolders = importedNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Folder
      );
      expect(importedFolders.length).toBe(sourceFolders.length);

      // Verify table count
      const sourceTables = updatedSourceNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Table
      );
      const importedTables = importedNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Table
      );
      expect(importedTables.length).toBe(sourceTables.length);

      // Verify dashboard count
      const sourceDashboards = updatedSourceNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Dashboard
      );
      const importedDashboards = importedNodes.filter(
        (n) => n.resourceType === BaseNodeResourceType.Dashboard
      );
      expect(importedDashboards.length).toBe(sourceDashboards.length);

      // Verify hierarchy: nodes with parents should still have parents
      const sourceNodesWithParent = updatedSourceNodes.filter((n) => n.parentId !== null);
      const importedNodesWithParent = importedNodes.filter((n) => n.parentId !== null);
      expect(importedNodesWithParent.length).toBe(sourceNodesWithParent.length);

      // Verify folder names are preserved
      const sourceFolderNames = sourceFolders.map((f) => f.resourceMeta?.name).sort();
      const importedFolderNames = importedFolders.map((f) => f.resourceMeta?.name).sort();
      expect(importedFolderNames).toEqual(sourceFolderNames);

      // Verify that table inside folder1 exists in imported base
      const importedFolder1 = importedFolders.find(
        (f) => f.resourceMeta?.name === folder1Node.resourceMeta?.name
      );
      expect(importedFolder1).toBeDefined();
      const tableInsideFolder = importedNodes.find((n) => {
        return n.resourceType === BaseNodeResourceType.Table && n.parentId === importedFolder1!.id;
      });
      expect(tableInsideFolder).toBeDefined();

      // Verify that dashboard inside folder2 exists in imported base
      const importedFolder2 = importedFolders.find(
        (f) => f.resourceMeta?.name === folder2Node.resourceMeta?.name
      );
      expect(importedFolder2).toBeDefined();
      const dashboardInsideFolder = importedNodes.find((n) => {
        return (
          n.resourceType === BaseNodeResourceType.Dashboard && n.parentId === importedFolder2!.id
        );
      });
      expect(dashboardInsideFolder).toBeDefined();

      // Verify tables are accessible
      const importedTableList = await getTableList(importedNodeBaseId).then((res) => res.data);
      expect(importedTableList.length).toBe(2);
      expect(importedTableList.map((t) => t.name).sort()).toEqual(
        [table1Node.resourceMeta?.name, table2Node.resourceMeta?.name].sort()
      );

      // Verify dashboards are accessible
      const importedDashboardList = await getDashboardList(importedNodeBaseId).then(
        (res) => res.data
      );
      expect(importedDashboardList.length).toBe(2);
      expect(importedDashboardList.map((d) => d.name).sort()).toEqual(
        [dashboard1Node.resourceMeta?.name, dashboard2Node.resourceMeta?.name].sort()
      );
    });
  });

  describe('import base with multiple link fields targeting the same table', () => {
    let multiLinkSourceBaseId: string;
    let importedMultiLinkBaseId: string | undefined;
    let awaitMultiLinkExport: <T>(fn: () => Promise<T>) => Promise<{ previewUrl: string }>;

    beforeAll(async () => {
      awaitMultiLinkExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
    });

    afterAll(async () => {
      if (importedMultiLinkBaseId) {
        await permanentDeleteBase(importedMultiLinkBaseId);
      }
      if (multiLinkSourceBaseId) {
        await permanentDeleteBase(multiLinkSourceBaseId);
      }
    });

    it('should import base where multiple links point to the same foreign table without dbFieldName collision', async () => {
      const sourceBase = (await createBase({ name: 'multi_link_source', spaceId, icon: '🔗' }))
        .data;
      multiLinkSourceBaseId = sourceBase.id;

      const foreignTable = await createTable(multiLinkSourceBaseId, {
        name: 'SharedTarget',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [{ fields: { Title: 'Target A' } }, { fields: { Title: 'Target B' } }],
      });

      const hostTable = await createTable(multiLinkSourceBaseId, {
        name: 'MultiLinkHost',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Host 1' } }],
      });

      await createField(hostTable.id, {
        name: 'Link1',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
        },
      });

      await createField(hostTable.id, {
        name: 'Link2',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
        },
      });

      await createField(hostTable.id, {
        name: 'Link3',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
        },
      });

      // export & import
      const { previewUrl } = await awaitMultiLinkExport(async () => {
        await exportBase(multiLinkSourceBaseId);
      });

      const attachmentService = getAttachmentService(app);
      const clsService = app.get(ClsService);
      const notify = await clsService.runWith<Promise<IAttachmentItem>>(
        {
          user: { id: userId, name: 'Test', email: 'test@example.com', isAdmin: null },
        } as unknown as ClsStore,
        async () => attachmentService.uploadFromUrl(appUrl + previewUrl)
      );

      const { base: importedBase } = (
        await importBase({ notify: notify as unknown as INotifyVo, spaceId })
      ).data;
      importedMultiLinkBaseId = importedBase.id;

      const tableList = (await getTableList(importedMultiLinkBaseId)).data;
      expect(tableList.length).toBe(2);

      const importedHostMeta = tableList.find((t) => t.name === 'MultiLinkHost')!;
      const importedForeignMeta = tableList.find((t) => t.name === 'SharedTarget')!;

      const importedHostFields = (await getFields(importedHostMeta.id)).data;
      const importedForeignFields = (await getFields(importedForeignMeta.id)).data;

      const hostLinkFields = importedHostFields.filter((f) => f.type === FieldType.Link);
      expect(hostLinkFields.length).toBe(3);

      // the foreign table should have 3 symmetric link fields, each with a unique dbFieldName
      const foreignLinkFields = importedForeignFields.filter((f) => f.type === FieldType.Link);
      expect(foreignLinkFields.length).toBe(3);

      const foreignDbFieldNames = foreignLinkFields.map((f) => f.dbFieldName);
      const uniqueDbFieldNames = new Set(foreignDbFieldNames);
      expect(uniqueDbFieldNames.size).toBe(3);
    });
  });

  describe('import base via SSE stream endpoint', () => {
    let streamSourceBaseId: string;
    let importedStreamBaseId: string | undefined;
    let streamTable: ITableFullVo;
    let awaitStreamExport: <T>(fn: () => Promise<T>) => Promise<{ previewUrl: string }>;

    beforeAll(async () => {
      const sourceBase = (
        await createBase({
          name: 'stream_source_base',
          spaceId,
          icon: '🔄',
        })
      ).data;
      streamSourceBaseId = sourceBase.id;

      streamTable = await createTable(streamSourceBaseId, {
        name: 'stream_test_table',
        fields: x_20.fields,
        records: x_20.records,
      });

      awaitStreamExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
    });

    afterAll(async () => {
      if (importedStreamBaseId) {
        await permanentDeleteBase(importedStreamBaseId);
      }
      if (streamSourceBaseId) {
        await permanentDeleteBase(streamSourceBaseId);
      }
    });

    it('should import base via SSE stream and receive progress + done events', async () => {
      // 1. Export the source base
      const { previewUrl } = await awaitStreamExport(async () => {
        await exportBase(streamSourceBaseId);
      });

      // 2. Upload the .tea file
      const clsService = app.get(ClsService);
      const attachmentService = getAttachmentService(app);

      const notify = await clsService.runWith<Promise<IAttachmentItem>>(
        {
          user: {
            id: userId,
            name: 'Test User',
            email: 'test@example.com',
            isAdmin: null,
          },
        } as unknown as ClsStore,
        async () => {
          return await attachmentService.uploadFromUrl(appUrl + previewUrl);
        }
      );

      // 3. Call import-stream SSE endpoint with raw fetch
      const streamUrl = `${appUrl}/api${IMPORT_BASE_STREAM}`;

      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Cookie: cookie,
        },
        body: JSON.stringify({
          notify: notify as unknown as INotifyVo,
          spaceId,
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      // 4. Parse SSE events
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const progressEvents: { phase: string; detail?: string }[] = [];
      let doneEvent: IImportBaseSSEEvent | null = null;
      let errorEvent: IImportBaseSSEEvent | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          const event = JSON.parse(jsonStr) as IImportBaseSSEEvent;
          if (event.type === 'progress') {
            progressEvents.push({ phase: event.phase, detail: event.detail });
          } else if (event.type === 'done') {
            doneEvent = event;
          } else if (event.type === 'error') {
            errorEvent = event;
          }
        }
      }

      // 5. Verify: no error events
      expect(errorEvent).toBeNull();

      // 6. Verify: received progress events
      expect(progressEvents.length).toBeGreaterThan(0);

      // Verify some expected phases appear
      const phases = progressEvents.map((e) => e.phase);
      expect(phases).toContain('creating_base');
      expect(phases).toContain('creating_table');
      expect(phases).toContain('structure_created');

      // 7. Verify: received done event with proper structure
      expect(doneEvent).not.toBeNull();
      expect(doneEvent!.type).toBe('done');
      const result = (doneEvent as any).data;
      expect(result.base).toBeDefined();
      expect(result.base.spaceId).toBe(spaceId);
      expect(result.tableIdMap).toBeDefined();
      expect(result.fieldIdMap).toBeDefined();
      expect(result.viewIdMap).toBeDefined();

      importedStreamBaseId = result.base.id;

      // 8. Verify: imported base is accessible and correct
      const tableList = (await getTableList(importedStreamBaseId!)).data;
      expect(tableList.length).toBe(1);
      expect(tableList[0].name).toBe('stream_test_table');

      const importedTable = await getTable(importedStreamBaseId!, tableList[0].id, {
        includeContent: true,
      });
      expect(importedTable.fields!.length).toBe(streamTable.fields.length);
    });
  });
});
