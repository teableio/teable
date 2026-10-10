import type { INestApplication } from '@nestjs/common';
import { Role } from '@teable/core';
import type { ICreatePluginVo, IUserMeVo } from '@teable/openapi';
import {
  CREATE_PLUGIN,
  createPlugin,
  DELETE_PLUGIN,
  deleteBaseCollaborator,
  deletePlugin,
  emailBaseInvitation,
  getBaseCollaboratorList,
  getPluginContextMenu,
  getPluginContextMenuList,
  installPluginContextMenu,
  movePluginContextMenu,
  PLUGIN_CONTEXT_MENU_INSTALL,
  pluginContextMenuGetItemSchema,
  pluginContextMenuGetVoSchema,
  pluginContextMenuInstallVoSchema,
  PluginPosition,
  PrincipalType,
  publishPlugin,
  removePluginContextMenu,
  renamePluginContextMenu,
  submitPlugin,
  updatePluginContextMenuStorage,
  urlBuilder,
  USER_ME,
  z,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
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

  describe('install by a base creator', () => {
    let creatorUser: AxiosInstance;
    let creatorPlugin: ICreatePluginVo;

    beforeAll(async () => {
      creatorUser = await createNewUserAxios({
        email: `plugin-context-menu-creator-${Date.now()}@test.com`,
        password: 'TestPassword123!',
      });
      const me = await creatorUser.get<IUserMeVo>(USER_ME);
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { emails: [me.data.email], role: Role.Creator },
      });
    });

    beforeEach(async () => {
      // A Developing plugin installed by its own author: the published check admits it.
      const res = await creatorUser.post<ICreatePluginVo>(CREATE_PLUGIN, {
        name: 'creator plugin',
        logo: 'https://logo.com',
        positions: [PluginPosition.ContextMenu],
        autoCreateMember: true,
      });
      creatorPlugin = res.data;
    });

    afterEach(async () => {
      await creatorUser
        .delete(urlBuilder(DELETE_PLUGIN, { id: creatorPlugin.id }))
        .catch(() => undefined);
      await deleteBaseCollaborator({
        baseId,
        deleteBaseCollaboratorRo: {
          principalId: creatorPlugin.pluginUser!.id,
          principalType: PrincipalType.User,
        },
      }).catch(() => undefined);
    });

    it('seats the plugin user with the installer role, not owner', async () => {
      const res = await creatorUser.post(urlBuilder(PLUGIN_CONTEXT_MENU_INSTALL, { tableId }), {
        name: 'creator plugin',
        pluginId: creatorPlugin.id,
      });
      expect(res.status).toBe(201);

      const collaborators = await getBaseCollaboratorList(baseId, { includeSystem: true });
      const pluginCollaborator = collaborators.data.collaborators.find(
        (item) => item.type === PrincipalType.User && item.userId === creatorPlugin.pluginUser!.id
      );
      expect(pluginCollaborator?.role).toBe(Role.Creator);
    });

    it('rejects installing an unpublished plugin of another user', async () => {
      const developingPlugin = await createPlugin({
        name: 'developing plugin',
        logo: 'https://logo.com',
        positions: [PluginPosition.ContextMenu],
      });
      const error = await getError(() =>
        creatorUser.post(urlBuilder(PLUGIN_CONTEXT_MENU_INSTALL, { tableId }), {
          name: 'developing plugin',
          pluginId: developingPlugin.data.id,
        })
      );
      expect(error?.status).toBe(404);
      await deletePlugin(developingPlugin.data.id);
    });
  });
});
