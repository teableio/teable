import type { INestApplication } from '@nestjs/common';
import {
  createDashboard,
  createDashboardVoSchema,
  createPlugin,
  dashboardInstallPluginVoSchema,
  deleteDashboard,
  deletePlugin,
  getDashboard,
  getDashboardVoSchema,
  installPlugin,
  PluginPosition,
  publishPlugin,
  removePlugin,
  renameDashboard,
  renameDashboardVoSchema,
  renamePlugin,
  submitPlugin,
  updateLayoutDashboard,
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

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  beforeEach(async () => {
    const res = await createDashboard(baseId, dashboardRo);
    dashboardId = res.data.id;
  });

  afterEach(async () => {
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

    it('/api/dashboard/:id/plugin (POST) - plugin not found', async () => {
      const res = await createPlugin({
        name: 'plugin-no',
        logo: 'https://logo.com',
        positions: [PluginPosition.Dashboard],
      });
      const error = await getError(() =>
        installPlugin(baseId, dashboardId, {
          name: 'dddd',
          pluginId: res.data.id,
        })
      );
      await deletePlugin(res.data.id);
      expect(error?.status).toBe(404);
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
});
