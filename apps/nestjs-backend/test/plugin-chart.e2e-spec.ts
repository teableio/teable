import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { IBaseQueryVo, ITableFullVo } from '@teable/openapi';
import {
  createPluginPanel,
  createDashboard,
  deletePluginPanel,
  getPluginPanelInstallPluginQuery,
  getPluginPanelPlugin,
  installPluginPanel,
  pluginPanelPluginGetVoSchema,
  updateDashboardPluginStorage,
  updatePluginPanelStorage,
  baseQuerySchemaVo,
  urlBuilder,
  GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY,
  deleteDashboard,
  installPlugin,
  getDashboardInstallPlugin,
  getDashboardInstallPluginQuery,
  GET_DASHBOARD_INSTALL_PLUGIN_QUERY,
  getDashboardInstallPluginVoSchema,
} from '@teable/openapi';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('PluginController', () => {
  let app: INestApplication;
  let anonymousUser: ReturnType<typeof createAnonymousUserAxios>;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Plugin Chart', () => {
    let pluginPanelId: string;
    let table: ITableFullVo;
    const baseId = globalThis.testConfig.baseId;

    beforeEach(async () => {
      table = await createTable(baseId, {
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'age',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              name: 'Alice',
              age: 20,
            },
          },
          {
            fields: {
              name: 'Bob',
              age: 30,
            },
          },
          {
            fields: {
              name: 'Charlie',
              age: 40,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      await deletePluginPanel(table.id, pluginPanelId);
      await permanentDeleteTable(baseId, table.id);
    });

    async function preparePluginPanel(table: ITableFullVo) {
      const pluginPanelRes = await createPluginPanel(table.id, {
        name: 'plugin panel',
      });
      pluginPanelId = pluginPanelRes.data.id;

      const pluginId = 'plgchart';

      const installRes = await installPluginPanel(table.id, pluginPanelId, {
        name: 'plugin',
        pluginId,
      });
      const pluginInstallId = installRes.data.pluginInstallId;
      const textField = table.fields.find((field) => field.type === FieldType.SingleLineText)!;
      const numberField = table.fields.find((field) => field.type === FieldType.Number)!;
      const res = await getPluginPanelPlugin(table.id, pluginPanelId, pluginInstallId);
      expect(res.status).toBe(200);
      expect(pluginPanelPluginGetVoSchema.strict().safeParse(res.data).success).toBe(true);
      expect(res.data.pluginId).toBe(pluginId);

      await updatePluginPanelStorage(table.id, pluginPanelId, pluginInstallId, {
        storage: {
          config: {
            type: 'bar',
            xAxis: [{ column: textField.name, display: { type: 'bar', position: 'auto' } }],
            yAxis: [{ column: numberField.name, display: { type: 'bar', position: 'auto' } }],
          },
          query: {
            from: table.id,
            select: [
              { column: textField.id, alias: textField.name, type: 'field' },
              { column: numberField.id, alias: numberField.name, type: 'field' },
            ],
          },
        },
      });

      return { pluginPanelId, pluginId, pluginInstallId };
    }

    it('api/plugin/chart/:pluginInstallId/plugin-panel/:positionId/query (GET)', async () => {
      const { pluginPanelId, pluginInstallId } = await preparePluginPanel(table);

      const queryRes = await getPluginPanelInstallPluginQuery(pluginInstallId, pluginPanelId, {
        tableId: table.id,
      });
      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVo.strict().safeParse(queryRes.data).success).toBe(true);

      await expect(
        anonymousUser.get<IBaseQueryVo>(
          urlBuilder(GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY, {
            pluginInstallId: pluginInstallId,
            positionId: pluginPanelId,
          }),
          {
            params: { tableId: table.id },
          }
        )
      ).rejects.toThrow();
    });
  });

  describe('Dashboard Chart', () => {
    let dashboardId: string;
    let table: ITableFullVo;
    const baseId = globalThis.testConfig.baseId;

    beforeEach(async () => {
      table = await createTable(baseId, {
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'age',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              name: 'Alice',
              age: 20,
            },
          },
          {
            fields: {
              name: 'Bob',
              age: 30,
            },
          },
          {
            fields: {
              name: 'Charlie',
              age: 40,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      await deleteDashboard(baseId, dashboardId);
      await permanentDeleteTable(baseId, table.id);
    });

    async function prepareDashboard(table: ITableFullVo) {
      const dashboardRes = await createDashboard(baseId, {
        name: 'dashboard',
      });
      dashboardId = dashboardRes.data.id;

      const pluginId = 'plgchart';
      const installRes = await installPlugin(baseId, dashboardId, {
        name: 'plugin',
        pluginId,
      });
      const pluginInstallId = installRes.data.pluginInstallId;
      const textField = table.fields.find((field) => field.type === FieldType.SingleLineText)!;
      const numberField = table.fields.find((field) => field.type === FieldType.Number)!;
      const res = await getDashboardInstallPlugin(baseId, dashboardId, pluginInstallId);
      expect(res.status).toBe(200);
      expect(getDashboardInstallPluginVoSchema.strict().safeParse(res.data).success).toBe(true);
      expect(res.data.pluginId).toBe(pluginId);

      await updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, {
        config: {
          type: 'bar',
          xAxis: [{ column: textField.name, display: { type: 'bar', position: 'auto' } }],
          yAxis: [{ column: numberField.name, display: { type: 'bar', position: 'auto' } }],
        },
        query: {
          from: table.id,
          select: [
            { column: textField.id, alias: textField.name, type: 'field' },
            { column: numberField.id, alias: numberField.name, type: 'field' },
          ],
        },
      });

      return { dashboardId, pluginId, pluginInstallId };
    }

    it('api/plugin/chart/:pluginInstallId/dashboard/:positionId/query (GET)', async () => {
      const { pluginInstallId, dashboardId } = await prepareDashboard(table);
      const queryRes = await getDashboardInstallPluginQuery(pluginInstallId, dashboardId, {
        baseId,
      });
      expect(queryRes.status).toBe(200);
      expect(baseQuerySchemaVo.strict().safeParse(queryRes.data).success).toBe(true);

      await expect(
        anonymousUser.get<IBaseQueryVo>(
          urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN_QUERY, {
            pluginInstallId,
            positionId: dashboardId,
          }),
          {
            params: { baseId },
          }
        )
      ).rejects.toThrow();
    });
  });
});
