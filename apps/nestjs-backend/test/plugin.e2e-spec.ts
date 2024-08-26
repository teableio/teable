import type { INestApplication } from '@nestjs/common';
import {
  createPlugin,
  createPluginVoSchema,
  deletePlugin,
  getPlugin,
  getPlugins,
  getPluginsVoSchema,
  getPluginVoSchema,
  PluginPosition,
  PluginStatus,
  updatePlugin,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const mockPlugin = {
  name: 'plugin',
  logo: 'https://logo.com',
  description: 'desc',
  detailDesc: 'detail',
  helpUrl: 'https://help.com',
  positions: [PluginPosition.Dashboard],
  i18n: {
    en: {
      name: 'plugin',
      description: 'desc',
      detailDesc: 'detail',
    },
  },
};
describe('PluginController', () => {
  let app: INestApplication;
  let pluginId: string;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  beforeEach(async () => {
    const res = await createPlugin(mockPlugin);
    pluginId = res.data.id;
  });

  afterEach(async () => {
    await deletePlugin(pluginId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/plugin (POST)', async () => {
    const res = await createPlugin(mockPlugin);
    expect(createPluginVoSchema.strict().safeParse(res.data).success).toBe(true);
    expect(res.data.status).toBe(PluginStatus.Developing);
    expect(res.data.pluginUser).not.toBeUndefined();
    await deletePlugin(res.data.id);
  });

  it('/api/plugin/{pluginId} (GET)', async () => {
    const getRes = await getPlugin(pluginId);
    expect(getPluginVoSchema.strict().safeParse(getRes.data).success).toBe(true);
    expect(getRes.data.status).toBe(PluginStatus.Developing);
    expect(getRes.data.pluginUser).not.toBeUndefined();
    expect(getRes.data.pluginUser?.name).toEqual('plugin');
  });

  it('/api/plugin/{pluginId} (GET) - 404', async () => {
    const error = await getError(() => getPlugin('invalid-id'));
    expect(error?.status).toBe(404);
  });

  it('/api/plugin (GET)', async () => {
    const getRes = await getPlugins();
    expect(getPluginsVoSchema.safeParse(getRes.data).success).toBe(true);
    expect(getRes.data).toHaveLength(1);
  });

  it('/api/plugin/{pluginId} (DELETE)', async () => {
    const res = await createPlugin(mockPlugin);
    await deletePlugin(res.data.id);
    const error = await getError(() => getPlugin(res.data.id));
    expect(error?.status).toBe(404);
  });

  it('/api/plugin/{pluginId} (PUT)', async () => {
    const res = await createPlugin(mockPlugin);
    const updatePluginRo = {
      name: 'updated',
      description: 'updated',
      detailDesc: 'updated',
      helpUrl: 'https://updated.com',
      logo: 'https://updated.com',
      positions: [PluginPosition.Dashboard],
      i18n: {
        en: {
          name: 'updated',
          description: 'updated',
          detailDesc: 'updated',
        },
      },
    };
    const putRes = await updatePlugin(res.data.id, updatePluginRo);
    expect(putRes.data.name).toBe(updatePluginRo.name);
    expect(putRes.data.description).toBe(updatePluginRo.description);
    expect(putRes.data.detailDesc).toBe(updatePluginRo.detailDesc);
    expect(putRes.data.helpUrl).toBe(updatePluginRo.helpUrl);
    expect(putRes.data.logo).toBe(updatePluginRo.logo);
    expect(putRes.data.i18n).toEqual(updatePluginRo.i18n);
    await deletePlugin(res.data.id);
  });
});
