import type { INestApplication } from '@nestjs/common';
import {
  createPlugin,
  deletePlugin,
  getPluginContextMenu,
  getPluginContextMenuList,
  installPluginContextMenu,
  movePluginContextMenu,
  pluginContextMenuGetItemSchema,
  pluginContextMenuGetVoSchema,
  pluginContextMenuInstallVoSchema,
  PluginPosition,
  publishPlugin,
  removePluginContextMenu,
  renamePluginContextMenu,
  submitPlugin,
  updatePluginContextMenuStorage,
  z,
} from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Plugin Context Menu', () => {
  let app: INestApplication;
  let tableId: string;
  const baseId = globalThis.testConfig.baseId;
  let pluginId: string;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const tableRes = await createTable(baseId, {
      name: 'plugin-context-menu-table',
    });
    tableId = tableRes.id;

    const res = await createPlugin({
      name: 'plugin',
      logo: 'https://logo.com',
      positions: [PluginPosition.ContextMenu],
    });
    pluginId = res.data.id;
    await submitPlugin(pluginId);
    await publishPlugin(pluginId);
  });

  afterEach(async () => {
    await deletePlugin(pluginId);
    await permanentDeleteTable(baseId, tableId);
  });

  it('api/table/:tableId/plugin-context-menu/install (POST)', async () => {
    const res = await installPluginContextMenu(tableId, {
      name: 'plugin',
      pluginId,
    });
    expect(res.status).toBe(201);
    expect(pluginContextMenuInstallVoSchema.strict().safeParse(res.data).success).toBe(true);
  });

  describe('other than install', () => {
    let pluginInstallId: string;

    beforeEach(async () => {
      const res = await installPluginContextMenu(tableId, {
        name: 'plugin',
        pluginId,
      });
      pluginInstallId = res.data.pluginInstallId;
    });

    it('api/table/:tableId/plugin-context-menu (GET)', async () => {
      const res = await getPluginContextMenuList(tableId);
      expect(res.status).toBe(200);
      expect(z.array(pluginContextMenuGetItemSchema.strict()).safeParse(res.data).success).toBe(
        true
      );
      expect(res.data.length).toBe(1);
    });

    it('api/table/:tableId/plugin-context-menu/:pluginInstallId (GET)', async () => {
      const res = await getPluginContextMenu(tableId, pluginInstallId);
      expect(res.status).toBe(200);
      expect(pluginContextMenuGetVoSchema.strict().safeParse(res.data).success).toBe(true);
    });

    it('api/table/:tableId/plugin-context-menu/:pluginInstallId/rename (PATCH)', async () => {
      const res = await renamePluginContextMenu(tableId, pluginInstallId, {
        name: 'new name',
      });
      expect(res.status).toBe(200);
      expect(res.data.name).toBe('new name');
    });

    it('api/table/:tableId/plugin-context-menu/:pluginInstallId/update-storage (PUT)', async () => {
      const res = await updatePluginContextMenuStorage(tableId, pluginInstallId, {
        storage: {
          name: 'new name',
        },
      });
      expect(res.status).toBe(200);
      expect(res.data.storage).toEqual({
        name: 'new name',
      });
    });

    it('api/table/:tableId/plugin-context-menu/:pluginInstallId (DELETE)', async () => {
      const res = await removePluginContextMenu(tableId, pluginInstallId);
      expect(res.status).toBe(200);
    });

    it('api/table/:tableId/plugin-context-menu/:pluginInstallId/move (PUT)', async () => {
      const pluginInstallId2 = await installPluginContextMenu(tableId, {
        name: 'plugin2',
        pluginId,
      }).then((res) => res.data.pluginInstallId);
      const pluginInstallId3 = await installPluginContextMenu(tableId, {
        name: 'plugin3',
        pluginId,
      }).then((res) => res.data.pluginInstallId);
      const list = await getPluginContextMenuList(tableId);
      expect(list.data.map((item) => item.pluginInstallId)).toEqual([
        pluginInstallId,
        pluginInstallId2,
        pluginInstallId3,
      ]);
      const res = await movePluginContextMenu(tableId, pluginInstallId3, {
        anchorId: pluginInstallId2,
        position: 'before',
      });
      expect(res.status).toBe(200);
      const list2 = await getPluginContextMenuList(tableId);
      expect(list2.data.map((item) => item.pluginInstallId)).toEqual([
        pluginInstallId,
        pluginInstallId3,
        pluginInstallId2,
      ]);
    });
  });
});
