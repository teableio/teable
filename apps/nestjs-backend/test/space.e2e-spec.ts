/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getPluginEmail, IdPrefix, Role } from '@teable/core';
import type {
  ICreateSpaceVo,
  IUserMeVo,
  ListSpaceCollaboratorVo,
  ListSpaceInvitationLinkVo,
} from '@teable/openapi';
import {
  createSpace as apiCreateSpace,
  createSpaceInvitationLink as apiCreateSpaceInvitationLink,
  createSpaceInvitationLinkVoSchema,
  deleteSpace as apiDeleteSpace,
  deleteSpaceInvitationLink as apiDeleteSpaceInvitationLink,
  emailSpaceInvitation as apiEmailSpaceInvitation,
  getSpaceById as apiGetSpaceById,
  getSpaceCollaboratorList as apiGetSpaceCollaboratorList,
  getSpaceList as apiGetSpaceList,
  getSpaceVoSchema,
  listSpaceInvitationLink as apiListSpaceInvitationLink,
  updateSpace as apiUpdateSpace,
  updateSpaceInvitationLink as apiUpdateSpaceInvitationLink,
  CREATE_SPACE,
  EMAIL_SPACE_INVITATION,
  urlBuilder,
  DELETE_SPACE,
  listSpaceInvitationLink,
  updateSpaceCollaborator,
  USER_ME,
  deleteSpaceCollaborator,
  createBase,
  emailBaseInvitation,
  emailSpaceInvitation,
  getBaseCollaboratorList,
  CollaboratorType,
  getSpaceCollaboratorList,
  deleteBase,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { Events } from '../src/event-emitter/events';
import type { SpaceDeleteEvent, SpaceUpdateEvent } from '../src/event-emitter/events';
import { chartConfig } from '../src/features/plugin/official/config/chart';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('OpenAPI SpaceController (e2e)', () => {
  let app: INestApplication;
  const globalSpaceId: string = testConfig.spaceId;
  let spaceId: string;
  let event: EventEmitter2;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    spaceId = (await apiCreateSpace({ name: 'new space' })).data.id;
    event = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await apiDeleteSpace(spaceId);

    await app.close();
  });

  it('/api/space (POST)', async () => {
    expect(spaceId.startsWith(IdPrefix.Space)).toEqual(true);
  });

  it('/api/space/:spaceId (PUT)', async () => {
    event.once(Events.SPACE_UPDATE, async (payload: SpaceUpdateEvent) => {
      expect(payload).toBeDefined();
      expect(payload.name).toBe(Events.SPACE_UPDATE);
      expect(payload?.payload).toBeDefined();
      expect(payload?.payload?.space).toBeDefined();
    });

    const res = await apiUpdateSpace({
      spaceId,
      updateSpaceRo: { name: 'new space1' },
    });

    spaceId = res.data.id;
    expect(res.data.name).toEqual('new space1');
  });

  it('/api/space/:spaceId (GET)', async () => {
    const res = await apiGetSpaceById(globalSpaceId);

    expect(getSpaceVoSchema.safeParse(res.data).success).toEqual(true);
  });

  it('/api/space (GET)', async () => {
    const res = await apiGetSpaceList();
    expect(res.data.length > 0).toEqual(true);
  });

  it('/api/space/:spaceId (DELETE)', async () => {
    event.once(Events.SPACE_DELETE, async (payload: SpaceDeleteEvent) => {
      expect(payload).toBeDefined();
      expect(payload.name).toBe(Events.SPACE_DELETE);
      expect(payload?.payload).toBeDefined();
      expect(payload?.payload?.spaceId).toBeDefined();
    });

    const newSpaceRes = await apiCreateSpace({ name: 'delete space' });
    const res = await apiDeleteSpace(newSpaceRes.data.id);
    expect(res.status).toEqual(200);
    const error = await getError(() => apiDeleteSpace(newSpaceRes.data.id));
    expect(error?.status).toEqual(404);
  });

  it('/api/space/:spaceId/collaborators (GET)', async () => {
    const collaborators: ListSpaceCollaboratorVo = (await apiGetSpaceCollaboratorList(spaceId))
      .data;
    expect(collaborators).toHaveLength(1);
  });

  it('/api/space/:spaceId/collaborators (GET) - includeSystem', async () => {
    const base = await createBase({ spaceId, name: 'new base' });
    await emailBaseInvitation({
      baseId: base.data.id,
      emailBaseInvitationRo: { emails: [getPluginEmail(chartConfig.id)], role: Role.Creator },
    });
    const collaborators: ListSpaceCollaboratorVo = (
      await apiGetSpaceCollaboratorList(spaceId, { includeSystem: true, includeBase: true })
    ).data;
    await deleteBase(base.data.id);
    expect(collaborators).toHaveLength(2);
  });

  it('/api/space/:spaceId/collaborators (GET) - includeBase', async () => {
    const base = await createBase({ spaceId, name: 'new base' });
    await emailBaseInvitation({
      baseId: base.data.id,
      emailBaseInvitationRo: { emails: ['space-coll-base@example.com'], role: Role.Creator },
    });
    const collaborators: ListSpaceCollaboratorVo = (
      await apiGetSpaceCollaboratorList(spaceId, { includeBase: true })
    ).data;
    await deleteBase(base.data.id);
    expect(collaborators).toHaveLength(2);
  });

  describe('Space Invitation and operator collaborators', () => {
    const newUserEmail = 'newuser@example.com';
    const newUser3Email = 'newuser2@example.com';

    let userRequest: AxiosInstance;
    let user3Request: AxiosInstance;
    let space2Id: string;
    beforeEach(async () => {
      user3Request = await createNewUserAxios({
        email: newUser3Email,
        password: '12345678',
      });
      userRequest = await createNewUserAxios({
        email: newUserEmail,
        password: '12345678',
      });
      const res = await userRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
        name: 'new space',
      });
      space2Id = res.data.id;
      await userRequest.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId: space2Id }), {
        emails: [globalThis.testConfig.email],
        role: Role.Creator,
      });
    });

    afterEach(async () => {
      await userRequest.delete<null>(
        urlBuilder(DELETE_SPACE, {
          spaceId: space2Id,
        })
      );
    });

    it('/api/space/:spaceId/invitation/link (POST)', async () => {
      const res = await apiCreateSpaceInvitationLink({
        spaceId: space2Id,
        createSpaceInvitationLinkRo: { role: Role.Creator },
      });
      expect(createSpaceInvitationLinkVoSchema.safeParse(res.data).success).toEqual(true);

      const linkList = await listSpaceInvitationLink(space2Id);
      expect(linkList.data).toHaveLength(1);
    });

    it('/api/space/{spaceId}/invitation/link (POST) - exceeds limit role', async () => {
      const error = await getError(() =>
        apiCreateSpaceInvitationLink({
          spaceId: space2Id,
          createSpaceInvitationLinkRo: { role: Role.Owner },
        })
      );
      expect(error?.status).toBe(403);
    });

    it('/api/space/:spaceId/invitation/link/:invitationId (PATCH)', async () => {
      const res = await apiCreateSpaceInvitationLink({
        spaceId,
        createSpaceInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      const newSpaceUpdate = await apiUpdateSpaceInvitationLink({
        spaceId,
        invitationId: newInvitationId,
        updateSpaceInvitationLinkRo: { role: Role.Editor },
      });
      expect(newSpaceUpdate.data.role).toEqual(Role.Editor);
    });

    it('/api/space/:spaceId/invitation/link/:invitationId (PATCH) - exceeds limit role', async () => {
      const res = await apiCreateSpaceInvitationLink({
        spaceId: space2Id,
        createSpaceInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      const error = await getError(() =>
        apiUpdateSpaceInvitationLink({
          spaceId: space2Id,
          invitationId: newInvitationId,
          updateSpaceInvitationLinkRo: { role: Role.Owner },
        })
      );
      expect(error?.status).toBe(403);
    });

    it('/api/space/:spaceId/invitation/link (GET)', async () => {
      const res = await apiGetSpaceCollaboratorList(space2Id);
      expect(res.data).toHaveLength(2);
    });

    it('/api/space/:spaceId/invitation/link/:invitationId (DELETE)', async () => {
      const res = await apiCreateSpaceInvitationLink({
        spaceId: space2Id,
        createSpaceInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      await apiDeleteSpaceInvitationLink({ spaceId: space2Id, invitationId: newInvitationId });

      const list: ListSpaceInvitationLinkVo = (await apiListSpaceInvitationLink(space2Id)).data;
      expect(list.find((v) => v.invitationId === newInvitationId)).toBeUndefined();
    });

    it('/api/space/:spaceId/invitation/email (POST)', async () => {
      await apiEmailSpaceInvitation({
        spaceId: space2Id,
        emailSpaceInvitationRo: { role: Role.Creator, emails: [newUser3Email] },
      });

      const collaborators: ListSpaceCollaboratorVo = (await apiGetSpaceCollaboratorList(space2Id))
        .data;

      const newCollaboratorInfo = collaborators.find(({ email }) => email === newUser3Email);

      expect(newCollaboratorInfo).not.toBeUndefined();
      expect(newCollaboratorInfo?.role).toEqual(Role.Creator);
    });

    it('/api/space/:spaceId/invitation/email (POST) - exceeds limit role', async () => {
      const error = await getError(() =>
        apiEmailSpaceInvitation({
          spaceId: space2Id,
          emailSpaceInvitationRo: { emails: [newUser3Email], role: Role.Owner },
        })
      );
      expect(error?.status).toBe(403);
    });

    it('/api/space/:spaceId/invitation/email (POST) - not exist email', async () => {
      await apiEmailSpaceInvitation({
        spaceId: space2Id,
        emailSpaceInvitationRo: { emails: ['not.exist@email.com'], role: Role.Creator },
      });
      const collaborators = (await apiGetSpaceCollaboratorList(space2Id)).data;
      expect(collaborators).toHaveLength(3);
    });

    it('/api/space/:spaceId/invitation/email (POST) - user in base', async () => {
      const base = await createBase({ spaceId: space2Id, name: 'new base' });
      await emailBaseInvitation({
        baseId: base.data.id,
        emailBaseInvitationRo: {
          emails: [newUser3Email],
          role: Role.Editor,
        },
      });
      const baseColl = await getBaseCollaboratorList(base.data.id);
      const spaceColl = await getSpaceCollaboratorList(space2Id);
      expect(spaceColl.data).toHaveLength(2);
      expect(baseColl.data).toHaveLength(3);
      expect(baseColl.data.find((v) => v.email === newUser3Email)?.resourceType).toEqual(
        CollaboratorType.Base
      );

      await emailSpaceInvitation({
        spaceId: space2Id,
        emailSpaceInvitationRo: {
          emails: [newUser3Email],
          role: Role.Editor,
        },
      });
      const newBaseColl = await getBaseCollaboratorList(base.data.id);
      const newSpaceColl = await getSpaceCollaboratorList(space2Id);
      expect(newSpaceColl.data).toHaveLength(3);
      expect(newBaseColl.data).toHaveLength(3);
      expect(newBaseColl.data.find((v) => v.email === newUser3Email)?.resourceType).toEqual(
        CollaboratorType.Space
      );
    });

    describe('operator collaborators', () => {
      let newUser3Id: string;
      beforeEach(async () => {
        await userRequest.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId: space2Id }), {
          emails: [newUser3Email],
          role: Role.Editor,
        });
        const res = await user3Request.get<IUserMeVo>(USER_ME);
        newUser3Id = res.data.id;
      });

      it('/api/space/:spaceId/collaborators (PATCH)', async () => {
        const res = await updateSpaceCollaborator({
          spaceId: space2Id,
          updateSpaceCollaborateRo: {
            role: Role.Creator,
            userId: newUser3Id,
          },
        });
        expect(res.status).toBe(200);
      });

      it('/api/space/:spaceId/collaborators (PATCH) - exceeds limit role', async () => {
        const error = await getError(() =>
          updateSpaceCollaborator({
            spaceId: space2Id,
            updateSpaceCollaborateRo: {
              role: Role.Owner,
              userId: newUser3Id,
            },
          })
        );
        expect(error?.status).toBe(403);
      });

      it('/api/space/:spaceId/collaborators (DELETE)', async () => {
        const res = await deleteSpaceCollaborator({
          spaceId: space2Id,
          userId: newUser3Id,
        });
        expect(res.status).toBe(200);
        const collList = await apiGetSpaceCollaboratorList(space2Id);
        expect(collList.data).toHaveLength(2);
      });

      it('/api/space/:spaceId/collaborators (DELETE) - exceeds limit role', async () => {
        await updateSpaceCollaborator({
          spaceId: space2Id,
          updateSpaceCollaborateRo: {
            role: Role.Creator,
            userId: newUser3Id,
          },
        });
        const error = await getError(() =>
          deleteSpaceCollaborator({
            spaceId: space2Id,
            userId: newUser3Id,
          })
        );
        expect(error?.status).toBe(403);
      });

      it('/api/space/:spaceId/collaborators (DELETE) - self', async () => {
        await deleteSpaceCollaborator({
          spaceId: space2Id,
          userId: globalThis.testConfig.userId,
        });
        const error = await getError(() => apiGetSpaceCollaboratorList(space2Id));
        expect(error?.status).toBe(403);
      });
    });
  });
});
