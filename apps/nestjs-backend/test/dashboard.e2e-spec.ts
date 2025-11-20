/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
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
  getDashboardTestSqlResult,
  ChartType,
  DataSource,
  FieldRollup,
  baseQuerySchemaVoV2,
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

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - Table dataSource with Bar chart', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      // Update storage configuration
      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Sum,
            },
          ],
          groupBy: null,
        },
        config: {},
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: false,
        },
      });

      // Query data
      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
      expect(queryRes.data).toHaveProperty('result');
      expect(queryRes.data).toHaveProperty('columns');
      expect(Array.isArray(queryRes.data.result)).toBe(true);
      expect(Array.isArray(queryRes.data.columns)).toBe(true);

      // Verify columns structure - should contain xAxis field ID and aggregation field
      expect(queryRes.data.columns.length).toBe(2);
      expect(queryRes.data.columns[0]).toEqual({
        name: textField.id,
        isNumber: false,
      });
      expect(queryRes.data.columns[1]).toEqual({
        name: `${numberField.name}_${FieldRollup.Sum}`,
        isNumber: false, // SUM(null) = null, typeof null === 'object', so isNumber is false
      });

      // Verify result data structure
      // Default table has 3 empty records, GROUP BY textField.id aggregates null values into 1 row
      expect(queryRes.data.result.length).toBe(1);
      const firstRow = queryRes.data.result[0];

      // Verify exact data of the first row
      // All 3 empty records have null Count field, SUM(null) = null
      expect(firstRow).toEqual({
        [textField.id]: null, // xAxis field value is null
        [`${numberField.name}_${FieldRollup.Sum}`]: null, // SUM(null) = null
      });
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - Table dataSource with Pie chart', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Pie,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Sum,
            },
          ],
          groupBy: null,
        },
        config: {},
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: true,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
      expect(Array.isArray(queryRes.data.result)).toBe(true);
      expect(Array.isArray(queryRes.data.columns)).toBe(true);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - Table dataSource with Line chart', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Line,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Avg,
            },
          ],
          groupBy: null,
        },
        config: {},
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
      expect(queryRes.data.result).toBeDefined();
      expect(queryRes.data.columns).toBeDefined();
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - Table dataSource with Area chart', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Area,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Max,
            },
          ],
          groupBy: null,
        },
        config: {},
        appearance: {
          theme: 'light',
          legendVisible: false,
          labelVisible: false,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - Table dataSource with DonutChart', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.DonutChart,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Count,
            },
          ],
          groupBy: null,
        },
        config: {},
        appearance: {
          theme: 'dark',
          legendVisible: true,
          labelVisible: true,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - Table dataSource with multiple series', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Sum,
            },
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Avg,
            },
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Max,
            },
          ],
          groupBy: null,
        },
        config: {},
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
      expect(queryRes.data.columns.length).toBeGreaterThan(1);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - SQL dataSource with Bar chart', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      // Use SQL data source - dbTableName format is "schema"."table"
      const [schema, tableName] = table.dbTableName.split('.');
      const sql = `SELECT "${textField.name}" as category, SUM("${numberField.name}") as total FROM "${schema}"."${tableName}" GROUP BY "${textField.name}"`;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Sql,
        query: {
          sql,
        },
        config: {
          xAxis: 'category',
          yAxis: ['total'],
        },
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
      expect(Array.isArray(queryRes.data.result)).toBe(true);
      expect(Array.isArray(queryRes.data.columns)).toBe(true);
      expect(queryRes.data.columns.length).toBeGreaterThan(0);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - SQL dataSource with Line chart', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      // Use SQL data source - dbTableName format is "schema"."table"
      const [schema, tableName] = table.dbTableName.split('.');
      const sql = `SELECT "${textField.name}" as x_data, AVG("${numberField.name}") as avg_value FROM "${schema}"."${tableName}" GROUP BY "${textField.name}"`;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Line,
        dataSource: DataSource.Sql,
        query: {
          sql,
        },
        config: {
          xAxis: 'x_data',
          yAxis: ['avg_value'],
        },
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
    });

    it('/api/plugin/chart/test-sql (POST) - test SQL query', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;

      // Use SQL data source - dbTableName format is "schema"."table"
      const [schema, tableName] = table.dbTableName.split('.');
      const sql = `SELECT "${textField.name}" as category, COUNT(*) as count FROM "${schema}"."${tableName}" GROUP BY "${textField.name}"`;

      const testRes = await getDashboardTestSqlResult(baseId, sql);

      expect(testRes.status).toBe(201);
      expect(baseQuerySchemaVoV2.safeParse(testRes.data).success).toBe(true);
      expect(Array.isArray(testRes.data.result)).toBe(true);
      expect(Array.isArray(testRes.data.columns)).toBe(true);
      expect(testRes.data.columns.length).toBeGreaterThan(0);
      testRes.data.columns.forEach((col) => {
        expect(col).toHaveProperty('name');
        expect(col).toHaveProperty('isNumber');
      });
    });

    it('/api/plugin/chart/test-sql (POST) - test invalid SQL', async () => {
      const invalidSql = 'SELECT * FROM invalid_table_name_that_does_not_exist';

      const error = await getError(() => getDashboardTestSqlResult(baseId, invalidSql));

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - invalid pluginInstallId', async () => {
      const error = await getError(() =>
        getDashboardInstallPluginQueryV2('invalid-plugin-id', dashboardId, baseId)
      );

      expect(error?.status).toBe(404);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - invalid positionId (dashboardId)', async () => {
      const error = await getError(() =>
        getDashboardInstallPluginQueryV2(pluginInstallId, 'invalid-dashboard-id', baseId)
      );

      expect(error?.status).toBe(404);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - with orderBy', async () => {
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Sum,
            },
          ],
          orderBy: {
            on: numberField.id,
            order: 'desc',
          },
          groupBy: null,
        },
        config: {},
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
    });

    it('/api/plugin/chart/:pluginInstallId/dashboard/:positionId/query/v2 (GET) - with groupBy', async () => {
      // Assume table has a single select field for grouping
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        chartType: ChartType.Bar,
        dataSource: DataSource.Table,
        query: {
          tableId: table.id,
          viewId: table.views[0].id,
          xAxis: textField.id,
          seriesArray: [
            {
              fieldId: numberField.id,
              rollup: FieldRollup.Sum,
            },
          ],
          groupBy: textField.id,
        },
        config: {},
        appearance: {
          theme: 'light',
          legendVisible: true,
          labelVisible: false,
        },
      });

      const queryRes = await getDashboardInstallPluginQueryV2(pluginInstallId, dashboardId, baseId);

      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVoV2.safeParse(queryRes.data).success).toBe(true);
    });
  });
});
