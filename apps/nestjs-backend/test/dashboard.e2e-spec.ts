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
});
