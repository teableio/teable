import type { INestApplication } from '@nestjs/common';
import type { IGetPluginCenterListVo } from '@teable/openapi';
import {
  createPlugin,
  createPluginVoSchema,
  deletePlugin,
  getPlugin,
  getPluginCenterList,
  getPluginCenterListVoSchema,
  getPlugins,
  getPluginsVoSchema,
  getPluginVoSchema,
  PLUGIN_CENTER_GET_LIST,
  PluginPosition,
  PluginStatus,
  publishPlugin,
  submitPlugin,
  updatePlugin,
} from '@teable/openapi';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const mockPlugin = {
  name: 'plugin',
  logo: '/plugin/xxxxxxx',
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
  autoCreateMember: true,
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
    expect(getRes.data).toHaveLength(3);
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
      logo: 'https://updated.com/plugin/updated',
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
    await deletePlugin(res.data.id);
    expect(putRes.data.name).toBe(updatePluginRo.name);
    expect(putRes.data.description).toBe(updatePluginRo.description);
    expect(putRes.data.detailDesc).toBe(updatePluginRo.detailDesc);
    expect(putRes.data.helpUrl).toBe(updatePluginRo.helpUrl);
    expect(putRes.data.logo).toEqual(expect.stringContaining('plugin/updated'));
    expect(putRes.data.i18n).toEqual(updatePluginRo.i18n);
  });

  it('/api/plugin/{pluginId}/submit (POST)', async () => {
    const res = await createPlugin(mockPlugin);
    const submitRes = await submitPlugin(res.data.id);
    await deletePlugin(res.data.id);
    expect(submitRes.status).toBe(200);
  });

  it('/api/admin/plugin/{pluginId}/publish (PATCH)', async () => {
    const res = await createPlugin(mockPlugin);
    await submitPlugin(res.data.id);
    await publishPlugin(res.data.id);
    const getRes = await getPlugin(res.data.id);
    await deletePlugin(res.data.id);
    expect(getRes.data.status).toBe(PluginStatus.Published);
  });

  it('/api/plugin/center/list (GET)', async () => {
    const preList = await getPluginCenterList();
    const res = await createPlugin(mockPlugin);
    const postList = await getPluginCenterList();
    await deletePlugin(res.data.id);
    expect(postList.data).toHaveLength(preList.data.length + 1);
    expect(
      postList.data.find((p) => p.status === PluginStatus.Developing && p.id === res.data.id)
    ).not.toBeUndefined();
    expect(getPluginCenterListVoSchema.safeParse(preList.data).success).toBe(true);
  });

  it('/api/plugin/center/list (GET) - 404', async () => {
    const preList = await getPluginCenterList(mockPlugin.positions);
    const res = await createPlugin(mockPlugin);
    const newUserAxios = await createNewUserAxios({
      email: 'plugin-center-list@test.com',
      password: '12345678',
    });
    const plugins = await newUserAxios.get<IGetPluginCenterListVo>(PLUGIN_CENTER_GET_LIST, {
      params: {
        positions: JSON.stringify(mockPlugin.positions),
      },
    });
    await deletePlugin(res.data.id);
    expect(plugins.data).toHaveLength(preList.data.length - 1);
    expect(plugins.data.some((p) => p.id === res.data.id)).toBe(false);
  });
});
