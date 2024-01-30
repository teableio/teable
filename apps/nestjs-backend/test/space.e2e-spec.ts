/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { HttpError } from '@teable-group/core';
import { IdPrefix, SpaceRole } from '@teable-group/core';
import type { ListSpaceCollaboratorVo, ListSpaceInvitationLinkVo } from '@teable-group/openapi';
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
} from '@teable-group/openapi';
import { Events } from '../src/event-emitter/events';
import type { SpaceDeleteEvent, SpaceUpdateEvent } from '../src/event-emitter/events';
import { createNewUserAxios } from './utils/axios-instance/new-user';
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
    expect((await apiDeleteSpace(newSpaceRes.data.id)).status).toEqual(200);

    try {
      await apiDeleteSpace(newSpaceRes.data.id);
    } catch (error) {
      if ((error as HttpError).status !== 403) {
        throw error;
      }
    }
  });

  it('/api/space/:spaceId/collaborators (GET)', async () => {
    const collaborators: ListSpaceCollaboratorVo = (await apiGetSpaceCollaboratorList(spaceId))
      .data;
    expect(collaborators).toHaveLength(1);
  });

  describe('Space Invitation', () => {
    const newUserEmail = 'newuser@example.com';

    beforeEach(async () => {
      await createNewUserAxios({
        email: newUserEmail,
        password: '12345678',
      });
    });

    it('/api/space/:spaceId/invitation/link (POST)', async () => {
      const res = await apiCreateSpaceInvitationLink({
        spaceId,
        createSpaceInvitationLinkRo: { role: SpaceRole.Owner },
      });

      expect(createSpaceInvitationLinkVoSchema.safeParse(res.data).success).toEqual(true);
    });

    it('/api/space/:spaceId/invitation/link/:invitationId (PATCH)', async () => {
      const res = await apiCreateSpaceInvitationLink({
        spaceId,
        createSpaceInvitationLinkRo: { role: SpaceRole.Owner },
      });
      const newInvitationId = res.data.invitationId;

      const newSpaceUpdate = await apiUpdateSpaceInvitationLink({
        spaceId,
        invitationId: newInvitationId,
        updateSpaceInvitationLinkRo: { role: SpaceRole.Editor },
      });
      expect(newSpaceUpdate.data.role).toEqual(SpaceRole.Editor);

      await apiDeleteSpaceInvitationLink({ spaceId, invitationId: newInvitationId });
    });

    it('/api/space/:spaceId/invitation/link (GET)', async () => {
      const res = await apiGetSpaceCollaboratorList(spaceId);
      expect(res.data.length > 0).toEqual(true);
    });

    it('/api/space/:spaceId/invitation/link/:invitationId (DELETE)', async () => {
      const res = await apiCreateSpaceInvitationLink({
        spaceId,
        createSpaceInvitationLinkRo: { role: SpaceRole.Owner },
      });
      const newInvitationId = res.data.invitationId;

      await apiDeleteSpaceInvitationLink({ spaceId, invitationId: newInvitationId });

      const list: ListSpaceInvitationLinkVo = (await apiListSpaceInvitationLink(spaceId)).data;
      expect(list.findIndex((v) => v.invitationId === newInvitationId) < 0).toEqual(true);
    });

    it('/api/space/:spaceId/invitation/email (POST)', async () => {
      await apiEmailSpaceInvitation({
        spaceId,
        emailSpaceInvitationRo: { role: SpaceRole.Owner, emails: [newUserEmail] },
      });

      const collaborators: ListSpaceCollaboratorVo = (await apiGetSpaceCollaboratorList(spaceId))
        .data;

      const newCollaboratorInfo = collaborators.find(({ email }) => email === newUserEmail);

      expect(newCollaboratorInfo).not.toBeUndefined();
      expect(newCollaboratorInfo?.role).toEqual(SpaceRole.Owner);
    });
  });
});
