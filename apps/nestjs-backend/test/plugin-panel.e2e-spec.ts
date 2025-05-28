import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable/openapi';
import {
  createPlugin,
  createPluginPanel,
  deletePlugin,
  deletePluginPanel,
  duplicatePluginPanel,
  duplicatePluginPanelInstalledPlugin,
  getPluginPanel,
  getPluginPanelPlugin,
  installPluginPanel,
  pluginPanelGetVoSchema,
  pluginPanelPluginGetVoSchema,
  PluginPosition,
  publishPlugin,
  removePluginPanelPlugin,
  renamePluginPanel,
  renamePluginPanelPlugin,
  submitPlugin,
  updateDashboardPluginStorage,
  updatePluginPanelLayout,
  updatePluginPanelStorage,
} from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('plugin panel', () => {
  let app: INestApplication;
  let pluginPanelId: string;
  let tableId: string;
  let table: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, {
      name: 'plugin-panel-table',
    });
    tableId = table.id;
    const res = await createPluginPanel(tableId, {
      name: 'plugin panel',
    });
    pluginPanelId = res.data.id;
  });

  afterEach(async () => {
    await deletePluginPanel(tableId, pluginPanelId);
    await permanentDeleteTable(baseId, tableId);
  });

  it('/api/table/:tableId/plugin-panel/:pluginPanelId/rename (PATCH)', async () => {
    const res = await renamePluginPanel(tableId, pluginPanelId, {
      name: 'new name',
    });
    expect(res.status).toBe(200);
    expect(res.data.name).toBe('new name');
  });

  it('/api/table/:tableId/plugin-panel/:pluginPanelId (GET)', async () => {
    const res = await getPluginPanel(tableId, pluginPanelId);
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(pluginPanelId);
    expect(pluginPanelGetVoSchema.strict().safeParse(res.data).success).toBe(true);
  });

  describe('plugin panel plugin', () => {
    let pluginId: string;
    beforeEach(async () => {
      const res = await createPlugin({
        name: 'plugin',
        logo: 'https://logo.com',
        positions: [PluginPosition.Panel],
      });
      pluginId = res.data.id;
      await submitPlugin(pluginId);
      await publishPlugin(pluginId);
    });

    afterEach(async () => {
      await deletePlugin(pluginId);
    });

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/install (POST)', async () => {
      const res = await installPluginPanel(tableId, pluginPanelId, {
        name: 'plugin',
        pluginId,
      });
      expect(res.status).toBe(201);
      expect(res.data.name).toBe('plugin');
      expect(res.data.pluginInstallId).toBeDefined();

      const pluginPanel = await getPluginPanel(tableId, pluginPanelId);
      expect(pluginPanel.status).toBe(200);
      expect(pluginPanelGetVoSchema.strict().safeParse(pluginPanel.data).success).toBe(true);
      expect(pluginPanel.data.pluginMap?.[res.data.pluginInstallId].id).toBe(pluginId);
      expect(pluginPanel.data.layout).toBeDefined();
    });

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/duplicate (POST)', async () => {
      const installedPlugin = (
        await installPluginPanel(tableId, pluginPanelId, {
          name: 'plugin',
          pluginId,
        })
      ).data;
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      await updatePluginPanelStorage(tableId, pluginPanelId, installedPlugin.pluginInstallId, {
        storage: {
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
        },
      });
      const duplicatePanel = (
        await duplicatePluginPanel(tableId, pluginPanelId, {
          name: 'plugin-panel-copy',
        })
      ).data;
      const duplicatedPluginPanel = (await getPluginPanel(tableId, duplicatePanel.id)).data;
      const duplicateInstalledPlugin = await getPluginPanelPlugin(
        tableId,
        duplicatePanel.id,
        duplicatedPluginPanel.layout![0].pluginInstallId!
      );
      expect(duplicateInstalledPlugin.data.storage).toEqual({
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

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId/duplicate (POST)', async () => {
      const installedPlugin = (
        await installPluginPanel(tableId, pluginPanelId, {
          name: 'plugin',
          pluginId,
        })
      ).data;
      const textField = table.fields.find((field) => field.name === 'Name')!;
      const numberField = table.fields.find((field) => field.name === 'Count')!;
      await updatePluginPanelStorage(tableId, pluginPanelId, installedPlugin.pluginInstallId, {
        storage: {
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
        },
      });
      const duplicatedInstalledPlugin = (
        await duplicatePluginPanelInstalledPlugin(
          tableId,
          pluginPanelId,
          installedPlugin.pluginInstallId,
          {
            name: 'plugin copy',
          }
        )
      ).data;
      const duplicatedInstallPluginInfo = await getPluginPanelPlugin(
        tableId,
        pluginPanelId,
        duplicatedInstalledPlugin.id
      );
      expect(duplicatedInstallPluginInfo.data.storage).toEqual({
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

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId/rename (PATCH)', async () => {
      const installRes = await installPluginPanel(tableId, pluginPanelId, {
        name: 'plugin',
        pluginId,
      });
      const res = await renamePluginPanelPlugin(
        tableId,
        pluginPanelId,
        installRes.data.pluginInstallId,
        'new name'
      );
      expect(res.status).toBe(200);
      expect(res.data.name).toBe('new name');
    });

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId (DELETE)', async () => {
      const installRes = await installPluginPanel(tableId, pluginPanelId, {
        name: 'plugin',
        pluginId,
      });
      const res = await removePluginPanelPlugin(
        tableId,
        pluginPanelId,
        installRes.data.pluginInstallId
      );
      expect(res.status).toBe(200);
    });

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId (GET)', async () => {
      const installRes = await installPluginPanel(tableId, pluginPanelId, {
        name: 'plugin',
        pluginId,
      });
      const res = await getPluginPanelPlugin(
        tableId,
        pluginPanelId,
        installRes.data.pluginInstallId
      );
      expect(res.status).toBe(200);
      expect(pluginPanelPluginGetVoSchema.strict().safeParse(res.data).success).toBe(true);
      expect(res.data.pluginId).toBe(pluginId);
    });

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/update-layout (PATCH)', async () => {
      const installRes = await installPluginPanel(tableId, pluginPanelId, {
        name: 'plugin',
        pluginId,
      });
      const res = await updatePluginPanelLayout(tableId, pluginPanelId, {
        layout: [
          {
            pluginInstallId: installRes.data.pluginInstallId,
            x: 0,
            y: 0,
            w: 1,
            h: 4,
          },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.data.layout).toBeDefined();
    });

    it('/api/table/:tableId/plugin-panel/:pluginPanelId/plugin/:pluginInstallId/storage (PATCH)', async () => {
      const installRes = await installPluginPanel(tableId, pluginPanelId, {
        name: 'plugin',
        pluginId,
      });
      const res = await updatePluginPanelStorage(
        tableId,
        pluginPanelId,
        installRes.data.pluginInstallId,
        {
          storage: {
            test: 'test',
          },
        }
      );
      expect(res.status).toBe(200);
      expect(res.data.storage).toEqual({ test: 'test' });
    });
  });
});
