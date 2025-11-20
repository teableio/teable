/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, isGreater, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import {
  createDashboard,
  createDashboardVoSchema,
  createPlugin,
  createTable,
  dashboardInstallPluginVoSchema,
  deleteDashboard,
  deletePlugin,
  deleteTable,
  duplicateDashboard,
  duplicateDashboardInstalledPlugin,
  getDashboard,
  getDashboardInstallPlugin,
  getTableList,
  getDashboardVoSchema,
  installPlugin,
  PluginPosition,
  publishPlugin,
  removePlugin,
  renameDashboard,
  renameDashboardVoSchema,
  renamePlugin,
  submitPlugin,
  updateDashboardPluginStorage,
  updateLayoutDashboard,
  getDashboardInstallPluginQueryV2,
  ChartType,
  DataSource,
  FieldRollup,
  AGGREGATE_COUNT_KEY,
  DEFAULT_SERIES_ARRAY,
  THEMES_KEYS,
  getViewList,
  getFields,
  getRecords,
  updateRecords,
  createRecords,
  createView,
  getDashboardTestSqlResult,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const dashboardRo = {
  name: 'dashboard',
};

describe('DashboardController', () => {
  let app: INestApplication;
  let dashboardId: string;
  const baseId = globalThis.testConfig.baseId;
  let prisma: PrismaService;
  let table: ITableFullVo;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    const res = await createDashboard(baseId, dashboardRo);
    table = (
      await createTable(baseId, {
        name: 'table',
      })
    ).data;
    dashboardId = res.data.id;
  });

  afterEach(async () => {
    await deleteTable(baseId, table.id);
    await deleteDashboard(baseId, dashboardId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/dashboard (POST)', async () => {
    const res = await createDashboard(baseId, dashboardRo);
    expect(createDashboardVoSchema.strict().safeParse(res.data).success).toBe(true);
    expect(res.status).toBe(201);
    await deleteDashboard(baseId, res.data.id);
  });

  it('/api/dashboard/:id (GET)', async () => {
    const getRes = await getDashboard(baseId, dashboardId);
    expect(getDashboardVoSchema.strict().safeParse(getRes.data).success).toBe(true);
    expect(getRes.data.id).toBe(dashboardId);
  });

  it('/api/dashboard/:id (DELETE)', async () => {
    const res = await createDashboard(baseId, dashboardRo);
    await deleteDashboard(baseId, res.data.id);
    const error = await getError(() => getDashboard(baseId, res.data.id));
    expect(error?.status).toBe(404);
  });

  it('/api/dashboard/:id/rename (PATCH)', async () => {
    const res = await createDashboard(baseId, dashboardRo);
    const newName = 'new-dashboard';
    const renameRes = await renameDashboard(baseId, res.data.id, newName);
    expect(renameRes.data.name).toBe(newName);
    await deleteDashboard(baseId, res.data.id);
  });

  it('/api/dashboard/:id/layout (PATCH)', async () => {
    const res = await createDashboard(baseId, dashboardRo);
    const layout = [{ pluginInstallId: 'plugin-install-id', x: 0, y: 0, w: 1, h: 1 }];
    const updateRes = await updateLayoutDashboard(baseId, res.data.id, layout);
    expect(updateRes.data.layout).toEqual(layout);
    await deleteDashboard(baseId, res.data.id);
  });

  describe('plugin', () => {
    let pluginId: string;
    beforeEach(async () => {
      const res = await createPlugin({
        name: 'plugin',
        logo: 'https://logo.com',
        positions: [PluginPosition.Dashboard],
      });
      pluginId = res.data.id;
      await submitPlugin(pluginId);
      await publishPlugin(pluginId);
    });

    afterEach(async () => {
      await deletePlugin(pluginId);
    });

    it('/api/dashboard/:id/plugin (POST)', async () => {
      const installRes = await installPlugin(baseId, dashboardId, {
        name: 'plugin1111',
        pluginId,
      });
      const dashboard = await getDashboard(baseId, dashboardId);
      expect(getDashboardVoSchema.safeParse(dashboard.data).success).toBe(true);
      expect(installRes.data.name).toBe('plugin1111');
      expect(dashboardInstallPluginVoSchema.safeParse(installRes.data).success).toBe(true);
    });

    it('api/base/:baseId/dashboard/:id/duplicate (POST) - duplicate dashboard', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const res = (
        await createDashboard(baseId, {
          name: 'source-dashboard',
        })
      ).data;
      const sourceDashboardId = res.id;
      const installPluginRes = (
        await installPlugin(baseId, sourceDashboardId, {
          name: 'source-plugin-item',
          pluginId: 'plgchart',
        })
      ).data;
      await updateDashboardPluginStorage(
        baseId,
        sourceDashboardId,
        installPluginRes.pluginInstallId,
        {
          config: {
            type: 'bar',
            xAxis: [{ column: 'Name', display: { type: 'bar', position: 'auto' } }],
            yAxis: [{ column: 'Count', display: { type: 'bar', position: 'auto' } }],
          },
          query: {
            from: table.id,
            select: [
              { column: textField.id, alias: 'Name', type: 'field' },
              { column: numberField.id, alias: 'Count', type: 'field' },
            ],
          },
        }
      );
      const duplicateRes = (
        await duplicateDashboard(baseId, sourceDashboardId, {
          name: 'source-plugin copy',
        })
      ).data;

      const { id } = duplicateRes;

      const duplicatedDashboard = (await getDashboard(baseId, id)).data;
      const duplicatedInstallPlugin = await getDashboardInstallPlugin(
        baseId,
        duplicatedDashboard.id,
        duplicatedDashboard.layout![0].pluginInstallId
      );
      expect(
        duplicatedDashboard.pluginMap?.[duplicatedDashboard.layout![0].pluginInstallId]
      ).toBeDefined();
      expect(
        duplicatedDashboard.pluginMap?.[duplicatedDashboard.layout![0].pluginInstallId]?.name
      ).toBe('source-plugin-item');

      expect(duplicatedInstallPlugin.data.storage).toEqual({
        config: {
          type: 'bar',
          xAxis: [{ column: 'Name', display: { type: 'bar', position: 'auto' } }],
          yAxis: [{ column: 'Count', display: { type: 'bar', position: 'auto' } }],
        },
        query: {
          from: table.id,
          select: [
            { column: textField.id, alias: 'Name', type: 'field' },
            { column: numberField.id, alias: 'Count', type: 'field' },
          ],
        },
      });
    });

    it('api/base/:baseId/dashboard/:id/plugin/:pluginInstallId/duplicate (POST) - duplicate installed dashboard plugin', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const res = (
        await createDashboard(baseId, {
          name: 'source-dashboard',
        })
      ).data;
      const sourceDashboardId = res.id;
      const installPluginRes = (
        await installPlugin(baseId, sourceDashboardId, {
          name: 'source-plugin-item',
          pluginId: 'plgchart',
        })
      ).data;
      await updateDashboardPluginStorage(
        baseId,
        sourceDashboardId,
        installPluginRes.pluginInstallId,
        {
          config: {
            type: 'bar',
            xAxis: [{ column: 'Name', display: { type: 'bar', position: 'auto' } }],
            yAxis: [{ column: 'Count', display: { type: 'bar', position: 'auto' } }],
          },
          query: {
            from: table.id,
            select: [
              { column: textField.id, alias: 'Name', type: 'field' },
              { column: numberField.id, alias: 'Count', type: 'field' },
            ],
          },
        }
      );
      const duplicateInstalledPlugin = (
        await duplicateDashboardInstalledPlugin(
          baseId,
          sourceDashboardId,
          installPluginRes.pluginInstallId,
          {
            name: 'source-plugin-item copy',
          }
        )
      ).data;

      const { id } = duplicateInstalledPlugin;

      const sourceDashboard = (await getDashboard(baseId, sourceDashboardId)).data;

      const duplicatedInstallPlugin = await getDashboardInstallPlugin(
        baseId,
        sourceDashboard.id,
        id
      );
      expect(sourceDashboard.pluginMap?.[sourceDashboard.layout![0].pluginInstallId]).toBeDefined();
      expect(sourceDashboard.pluginMap?.[id]?.name).toBe('source-plugin-item copy');

      expect(duplicatedInstallPlugin.data.storage).toEqual({
        config: {
          type: 'bar',
          xAxis: [{ column: 'Name', display: { type: 'bar', position: 'auto' } }],
          yAxis: [{ column: 'Count', display: { type: 'bar', position: 'auto' } }],
        },
        query: {
          from: table.id,
          select: [
            { column: textField.id, alias: 'Name', type: 'field' },
            { column: numberField.id, alias: 'Count', type: 'field' },
          ],
        },
      });
    });

    it('/api/dashboard/:id/plugin (POST) - plugin not found', async () => {
      const res = await createPlugin({
        name: 'plugin-no',
        logo: 'https://logo.com',
        positions: [PluginPosition.Dashboard],
      });
      const installRes = await installPlugin(baseId, dashboardId, {
        name: 'dddd',
        pluginId: res.data.id,
      });
      await prisma.plugin.update({
        where: { id: res.data.id },
        data: { createdBy: 'test-user' },
      });
      const error = await getError(() =>
        installPlugin(baseId, dashboardId, {
          name: 'dddd',
          pluginId: res.data.id,
        })
      );
      await deletePlugin(res.data.id);
      expect(error?.status).toBe(404);
      expect(installRes.data.name).toBe('dddd');
    });

    it('/api/dashboard/:id/plugin/:pluginInstallId/rename (PATCH)', async () => {
      const installRes = await installPlugin(baseId, dashboardId, {
        name: 'plugin1111',
        pluginId,
      });
      const newName = 'new-plugin';
      const renameRes = await renamePlugin(
        baseId,
        dashboardId,
        installRes.data.pluginInstallId,
        newName
      );
      expect(renameDashboardVoSchema.safeParse(renameRes.data).success).toBe(true);
      expect(renameRes.data.name).toBe(newName);
    });

    it('/api/dashboard/:id/plugin/:pluginInstallId (DELETE)', async () => {
      const installRes = await installPlugin(baseId, dashboardId, {
        name: 'plugin1111',
        pluginId,
      });
      await removePlugin(baseId, dashboardId, installRes.data.pluginInstallId);
      const dashboard = await getDashboard(baseId, dashboardId);
      expect(dashboard?.data?.pluginMap?.[pluginId]).toBeUndefined();
    });
  });

  describe('chart2 (plgchartV2)', () => {
    let pluginInstallId: string;

    beforeEach(async () => {
      const installRes = await installPlugin(baseId, dashboardId, {
        name: 'chart2-plugin',
        pluginId: 'plgchartV2',
      });
      pluginInstallId = installRes.data.pluginInstallId;
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - create a chart v2 with default configuration', async () => {
      const queryRes = (
        await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId)
      ).data;
      const tableList = (await getTableList(baseId)).data;
      const dashboardConfig = (
        await getDashboardInstallPlugin(baseId, dashboardId, pluginInstallId)
      ).data;

      const defaultTableId = tableList.at(0)?.id;

      const views = await getViewList(defaultTableId!);
      const defaultViewId = views.data.at(0)?.id;

      const fields = await getFields(defaultTableId!);
      const defaultFieldId = fields.data.at(0)?.id;

      expect(dashboardConfig.storage).toEqual({
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: defaultTableId,
          viewId: defaultViewId,
          filter: null,
          groupBy: null,
          orderBy: { on: 'xAxis', order: 'asc' },
          xAxis: defaultFieldId,
          seriesArray: DEFAULT_SERIES_ARRAY,
        },
        appearance: {
          theme: THEMES_KEYS.BLUE,
          legendVisible: true,
          labelVisible: false,
        },
      });
      expect(queryRes).toEqual({
        result: [{ [`${defaultFieldId}`]: null, [`${AGGREGATE_COUNT_KEY}`]: 3 }],
        columns: [
          { name: defaultFieldId, isNumber: false },
          { name: `${AGGREGATE_COUNT_KEY}`, isNumber: true },
        ],
      });
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - query data with a common configuration', async () => {
      const records = (await getRecords(table.id!, {})).data?.records;

      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const statusField = table.fields.find((field) => field.name === 'Status')!;

      // create example records
      await updateRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: records.map((record, index) => ({
          id: record.id,
          fields: {
            [textField.id]: `task${index + 1}`,
            [numberField.id]: index,
            [statusField.id]: 'To Do',
          },
        })),
      });

      await createRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [textField.id]: `task4`,
              [numberField.id]: 4,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task5`,
              [numberField.id]: 5,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task6`,
              [numberField.id]: 6,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task7`,
              [numberField.id]: 7,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task8`,
              [numberField.id]: 8,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task9`,
              [numberField.id]: 9,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task10`,
              [numberField.id]: 10,
              [statusField.id]: 'Done',
            },
          },
        ],
      });

      // update the storage configuration
      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: DEFAULT_SERIES_ARRAY,
          groupBy: null,
          orderBy: { on: 'xAxis', order: 'asc' },
        },
        appearance: {
          theme: THEMES_KEYS.BLUE,
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = (
        await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId)
      ).data;

      expect(queryRes.result).toEqual(
        expect.arrayContaining(
          Array.from({ length: 10 }, (_, index) => ({
            [`${textField.id}`]: `task${index + 1}`,
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          }))
        )
      );
      expect(queryRes.columns).toEqual(
        expect.arrayContaining([
          { name: textField.id, isNumber: false },
          { name: `${AGGREGATE_COUNT_KEY}`, isNumber: true },
        ])
      );
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - query data with a filter configuration', async () => {
      const records = (await getRecords(table.id!, {})).data?.records;

      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const statusField = table.fields.find((field) => field.name === 'Status')!;

      // create example records
      await updateRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: records.map((record, index) => ({
          id: record.id,
          fields: {
            [textField.id]: `task${index + 1}`,
            [numberField.id]: index,
            [statusField.id]: 'To Do',
          },
        })),
      });

      await createRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [textField.id]: `task4`,
              [numberField.id]: 4,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task5`,
              [numberField.id]: 5,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task6`,
              [numberField.id]: 6,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task7`,
              [numberField.id]: 7,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task8`,
              [numberField.id]: 8,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task9`,
              [numberField.id]: 9,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task10`,
              [numberField.id]: 10,
              [statusField.id]: 'Done',
            },
          },
        ],
      });

      // update the storage configuration
      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: null,
          xAxis: statusField.id,
          seriesArray: DEFAULT_SERIES_ARRAY,
          groupBy: null,
          orderBy: { on: 'xAxis', order: 'asc' },
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: numberField.id,
                operator: isGreater.value,
                value: 5,
              },
            ],
          },
        },
        appearance: {
          theme: THEMES_KEYS.BLUE,
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = (
        await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId)
      ).data;

      expect(queryRes.result).toEqual(
        expect.arrayContaining([
          {
            [statusField.id]: 'Done',
            [`${AGGREGATE_COUNT_KEY}`]: 4,
          },
          {
            [statusField.id]: 'In Progress',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
        ])
      );
      expect(queryRes.columns).toEqual(
        expect.arrayContaining([
          { name: statusField.id, isNumber: false },
          { name: `${AGGREGATE_COUNT_KEY}`, isNumber: true },
        ])
      );
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - query data with a filter configuration base on filter view', async () => {
      const records = (await getRecords(table.id!, {})).data?.records;

      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const statusField = table.fields.find((field) => field.name === 'Status')!;

      const view = (
        await createView(table.id!, {
          name: 'Filter View',
          type: ViewType.Grid,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: numberField.id, operator: isGreater.value, value: 7 }],
          },
        })
      ).data;

      // create example records
      await updateRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: records.map((record, index) => ({
          id: record.id,
          fields: {
            [textField.id]: `task${index + 1}`,
            [numberField.id]: index,
            [statusField.id]: 'To Do',
          },
        })),
      });

      await createRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [textField.id]: `task4`,
              [numberField.id]: 4,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task5`,
              [numberField.id]: 5,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task6`,
              [numberField.id]: 6,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task7`,
              [numberField.id]: 7,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task8`,
              [numberField.id]: 8,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task9`,
              [numberField.id]: 9,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task10`,
              [numberField.id]: 10,
              [statusField.id]: 'Done',
            },
          },
        ],
      });

      // update the storage configuration
      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: view.id,
          xAxis: statusField.id,
          seriesArray: DEFAULT_SERIES_ARRAY,
          groupBy: null,
          orderBy: { on: 'xAxis', order: 'asc' },
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: numberField.id,
                operator: isGreater.value,
                value: 5,
              },
            ],
          },
        },
        appearance: {
          theme: THEMES_KEYS.BLUE,
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = (
        await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId)
      ).data;

      expect(queryRes.result).toEqual(
        expect.arrayContaining([
          {
            [statusField.id]: 'Done',
            [`${AGGREGATE_COUNT_KEY}`]: 3,
          },
        ])
      );
      expect(queryRes.columns).toEqual(
        expect.arrayContaining([
          { name: statusField.id, isNumber: false },
          { name: `${AGGREGATE_COUNT_KEY}`, isNumber: true },
        ])
      );
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - query data with group configuration', async () => {
      const records = (await getRecords(table.id!, {})).data?.records;

      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const statusField = table.fields.find((field) => field.name === 'Status')!;

      // create example records
      await updateRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: records.map((record, index) => ({
          id: record.id,
          fields: {
            [textField.id]: `task${index + 1}`,
            [numberField.id]: index,
            [statusField.id]: 'To Do',
          },
        })),
      });

      await createRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [textField.id]: `task4`,
              [numberField.id]: 4,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task5`,
              [numberField.id]: 5,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task6`,
              [numberField.id]: 6,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task7`,
              [numberField.id]: 7,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task8`,
              [numberField.id]: 8,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task9`,
              [numberField.id]: 9,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task1`,
              [numberField.id]: 10,
              [statusField.id]: 'To Do',
            },
          },
        ],
      });

      // update the storage configuration
      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: null,
          xAxis: textField.id,
          seriesArray: DEFAULT_SERIES_ARRAY,
          groupBy: statusField.id,
          orderBy: { on: 'xAxis', order: 'asc' },
        },
        appearance: {
          theme: THEMES_KEYS.BLUE,
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = (
        await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId)
      ).data;

      expect(queryRes.result).toEqual(
        expect.arrayContaining([
          {
            [textField.id]: 'task1',
            [statusField.id]: 'To Do',
            [`${AGGREGATE_COUNT_KEY}`]: 2,
          },
          {
            [textField.id]: 'task2',
            [statusField.id]: 'To Do',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
          {
            [textField.id]: 'task3',
            [statusField.id]: 'To Do',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
          {
            [textField.id]: 'task4',
            [statusField.id]: 'In Progress',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
          {
            [textField.id]: 'task5',
            [statusField.id]: 'In Progress',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
          {
            [textField.id]: 'task6',
            [statusField.id]: 'In Progress',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
          {
            [textField.id]: 'task7',
            [statusField.id]: 'Done',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
          {
            [textField.id]: 'task8',
            [statusField.id]: 'Done',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
          {
            [textField.id]: 'task9',
            [statusField.id]: 'Done',
            [`${AGGREGATE_COUNT_KEY}`]: 1,
          },
        ])
      );
      expect(queryRes.columns).toEqual(
        expect.arrayContaining([
          { name: textField.id, isNumber: false },
          { name: statusField.id, isNumber: false },
          { name: `${AGGREGATE_COUNT_KEY}`, isNumber: true },
        ])
      );
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - query data with a value series type configuration', async () => {
      const records = (await getRecords(table.id!, {})).data?.records;

      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const statusField = table.fields.find((field) => field.name === 'Status')!;

      // create example records
      await updateRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: records.map((record, index) => ({
          id: record.id,
          fields: {
            [textField.id]: `task${index + 1}`,
            [numberField.id]: index + 1,
            [statusField.id]: 'To Do',
          },
        })),
      });

      await createRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [textField.id]: `task4`,
              [numberField.id]: 4,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task5`,
              [numberField.id]: 5,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task6`,
              [numberField.id]: 6,
              [statusField.id]: 'In Progress',
            },
          },
          {
            fields: {
              [textField.id]: `task7`,
              [numberField.id]: 7,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task8`,
              [numberField.id]: 8,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task9`,
              [numberField.id]: 9,
              [statusField.id]: 'Done',
            },
          },
          {
            fields: {
              [textField.id]: `task10`,
              [numberField.id]: 10,
              [statusField.id]: 'Done',
            },
          },
        ],
      });

      // update the storage configuration
      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: null,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Sum,
            },
          ],
          groupBy: null,
          orderBy: { on: 'xAxis', order: 'asc' },
        },
        appearance: {
          theme: THEMES_KEYS.BLUE,
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = (
        await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId)
      ).data;

      expect(queryRes.result).toEqual(
        expect.arrayContaining(
          Array.from({ length: 10 }, (_, index) => ({
            [`${textField.id}`]: `task${index + 1}`,
            [`${numberField.id}_${FieldRollup.Sum}`]: index + 1,
          }))
        )
      );
      expect(queryRes.columns).toEqual(
        expect.arrayContaining([
          { name: textField.id, isNumber: false },
          { name: `${numberField.id}_${FieldRollup.Sum}`, isNumber: true },
        ])
      );
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - sql data source', async () => {
      const dbTableName = table.dbTableName;
      const [schema, tableName] = dbTableName.split('.');
      const sql = `SELECT * FROM "${schema}"."${tableName}"`;
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const statusField = table.fields.find((field) => field.name === 'Status')!;
      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Sql,
        query: {
          sql,
        },
        appearance: {
          theme: THEMES_KEYS.BLUE,
          legendVisible: true,
          labelVisible: false,
        },
      });

      await createRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [textField.id]: 'task1', [numberField.id]: 1, [statusField.id]: 'To Do' } },
        ],
      });

      const queryRes = (
        await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId)
      ).data;

      const filterRes = queryRes.result.map((item) => {
        return {
          [textField.dbFieldName]: item[textField.dbFieldName],
          [numberField.dbFieldName]: item[numberField.dbFieldName],
          [statusField.dbFieldName]: item[statusField.dbFieldName],
        };
      });

      expect(filterRes).toEqual(
        expect.arrayContaining([
          {
            [textField.dbFieldName]: null,
            [numberField.dbFieldName]: null,
            [statusField.dbFieldName]: null,
          },
          {
            [textField.dbFieldName]: null,
            [numberField.dbFieldName]: null,
            [statusField.dbFieldName]: null,
          },
          {
            [textField.dbFieldName]: null,
            [numberField.dbFieldName]: null,
            [statusField.dbFieldName]: null,
          },
          {
            [textField.dbFieldName]: 'task1',
            [numberField.dbFieldName]: 1,
            [statusField.dbFieldName]: 'To Do',
          },
        ])
      );
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - test sql', async () => {
      const dbTableName = table.dbTableName;
      const [schema, tableName] = dbTableName.split('.');
      const sql = `SELECT * FROM "${schema}"."${tableName}"`;
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      const statusField = table.fields.find((field) => field.name === 'Status')!;

      await createRecords(table.id!, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [textField.id]: 'task1', [numberField.id]: 1, [statusField.id]: 'To Do' } },
        ],
      });

      const testSqlRes = (await getDashboardTestSqlResult(baseId, sql)).data;

      const filterRes = testSqlRes.result.map((item) => {
        return {
          [textField.dbFieldName]: item[textField.dbFieldName],
          [numberField.dbFieldName]: item[numberField.dbFieldName],
          [statusField.dbFieldName]: item[statusField.dbFieldName],
        };
      });

      expect(filterRes).toEqual(
        expect.arrayContaining([
          {
            [textField.dbFieldName]: null,
            [numberField.dbFieldName]: null,
            [statusField.dbFieldName]: null,
          },
          {
            [textField.dbFieldName]: null,
            [numberField.dbFieldName]: null,
            [statusField.dbFieldName]: null,
          },
          {
            [textField.dbFieldName]: null,
            [numberField.dbFieldName]: null,
            [statusField.dbFieldName]: null,
          },
          {
            [textField.dbFieldName]: 'task1',
            [numberField.dbFieldName]: 1,
            [statusField.dbFieldName]: 'To Do',
          },
        ])
      );
    });
  });
});
