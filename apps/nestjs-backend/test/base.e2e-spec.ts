import type { INestApplication } from '@nestjs/common';
import { Role } from '@teable/core';
import type {
  ICreateBaseVo,
  ICreateSpaceVo,
  IUserMeVo,
  ListBaseInvitationLinkVo,
} from '@teable/openapi';
import {
  CREATE_BASE,
  CREATE_BASE_INVITATION_LINK,
  CREATE_SPACE,
  createBaseInvitationLink,
  createBaseInvitationLinkVoSchema,
  DELETE_BASE,
  DELETE_SPACE,
  deleteBaseCollaborator,
  deleteBaseInvitationLink,
  EMAIL_BASE_INVITATION,
  emailBaseInvitation,
  getBaseCollaboratorList,
  listBaseInvitationLink,
  UPDATE_BASE_COLLABORATE,
  UPDATE_BASE_INVITATION_LINK,
  updateBaseCollaborator,
  updateBaseInvitationLink,
  urlBuilder,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('OpenAPI BaseController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Base Invitation and operator collaborators', () => {
    const newUserEmail = 'newuser@example.com';
    const newUser3Email = 'newuser2@example.com';

    let userRequest: AxiosInstance;
    let user3Request: AxiosInstance;
    let spaceId: string;
    let baseId: string;
    beforeAll(async () => {
      user3Request = await createNewUserAxios({
        email: newUser3Email,
        password: '12345678',
      });
      userRequest = await createNewUserAxios({
        email: newUserEmail,
        password: '12345678',
      });
      spaceId = (await userRequest.post<ICreateSpaceVo>(CREATE_SPACE, { name: 'new base' })).data
        .id;
    });
    beforeEach(async () => {
      const res = await userRequest.post<ICreateBaseVo>(CREATE_BASE, {
        name: 'new base',
        spaceId,
      });
      baseId = res.data.id;
      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [globalThis.testConfig.email],
        role: Role.Creator,
      });
    });

    afterEach(async () => {
      await userRequest.delete<null>(
        urlBuilder(DELETE_BASE, {
          baseId,
        })
      );
    });
    afterAll(async () => {
      await userRequest.delete<null>(
        urlBuilder(DELETE_SPACE, {
          spaceId,
        })
      );
    });

    it('/api/base/:baseId/invitation/link (POST)', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Creator },
      });
      expect(createBaseInvitationLinkVoSchema.safeParse(res.data).success).toEqual(true);

      const linkList = await listBaseInvitationLink(baseId);
      expect(linkList.data).toHaveLength(1);
    });

    it('/api/base/{baseId}/invitation/link (POST) - Forbidden', async () => {
      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [newUser3Email],
        role: Role.Editor,
      });
      const error = await getError(() =>
        user3Request.post(urlBuilder(CREATE_BASE_INVITATION_LINK, { baseId }), {
          role: Role.Creator,
        })
      );
      expect(error?.status).toBe(403);
    });

    it('/api/base/:baseId/invitation/link/:invitationId (PATCH)', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      const newBaseUpdate = await updateBaseInvitationLink({
        baseId,
        invitationId: newInvitationId,
        updateBaseInvitationLinkRo: { role: Role.Editor },
      });
      expect(newBaseUpdate.data.role).toEqual(Role.Editor);
    });

    it('/api/base/:baseId/invitation/link/:invitationId (PATCH) - exceeds limit role', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [newUser3Email],
        role: Role.Editor,
      });
      const error = await getError(() =>
        user3Request.patch(
          urlBuilder(UPDATE_BASE_INVITATION_LINK, { baseId, invitationId: newInvitationId }),
          { role: Role.Creator }
        )
      );
      expect(error?.status).toBe(403);
    });

    it('/api/base/:baseId/invitation/link (GET)', async () => {
      const res = await getBaseCollaboratorList(baseId);
      expect(res.data).toHaveLength(2);
    });

    it('/api/base/:baseId/invitation/link/:invitationId (DELETE)', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      await deleteBaseInvitationLink({ baseId, invitationId: newInvitationId });

      const list: ListBaseInvitationLinkVo = (await listBaseInvitationLink(baseId)).data;
      expect(list.find((v) => v.invitationId === newInvitationId)).toBeUndefined();
    });

    it('/api/base/:baseId/invitation/email (POST)', async () => {
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { role: Role.Creator, emails: [newUser3Email] },
      });

      const collaborators = (await getBaseCollaboratorList(baseId)).data;

      const newCollaboratorInfo = collaborators.find(({ email }) => email === newUser3Email);

      expect(newCollaboratorInfo).not.toBeUndefined();
      expect(newCollaboratorInfo?.role).toEqual(Role.Creator);
    });

    it('/api/base/:baseId/invitation/email (POST) - exceeds limit role', async () => {
      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [newUser3Email],
        role: Role.Editor,
      });
      const error = await getError(() =>
        user3Request.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
          emails: [newUser3Email],
          role: Role.Creator,
        })
      );
      expect(error?.status).toBe(403);
    });

    it('/api/base/:baseId/invitation/email (POST) - not exist email', async () => {
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { emails: ['not.exist@email.com'], role: Role.Creator },
      });
      const collaborators = (await getBaseCollaboratorList(baseId)).data;
      expect(collaborators).toHaveLength(3);
    });

    it('/api/base/:baseId/invitation/email (POST) - user in space', async () => {
      const error = await getError(() =>
        emailBaseInvitation({
          baseId,
          emailBaseInvitationRo: { emails: [globalThis.testConfig.email], role: Role.Creator },
        })
      );
      expect(error?.status).toBe(400);
    });

    describe('operator collaborators', () => {
      let newUser3Id: string;
      beforeEach(async () => {
        await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
          emails: [newUser3Email],
          role: Role.Editor,
        });
        const res = await user3Request.get<IUserMeVo>(USER_ME);
        newUser3Id = res.data.id;
      });

      it('/api/base/:baseId/collaborators (PATCH)', async () => {
        const res = await updateBaseCollaborator({
          baseId,
          updateBaseCollaborateRo: {
            role: Role.Creator,
            userId: newUser3Id,
          },
        });
        expect(res.status).toBe(200);
      });

      it('/api/base/:baseId/collaborators (PATCH) - exceeds limit role', async () => {
        const error = await getError(() =>
          user3Request.patch<void>(
            urlBuilder(UPDATE_BASE_COLLABORATE, {
              baseId,
            }),
            {
              role: Role.Creator,
              userId: newUser3Id,
            }
          )
        );
        expect(error?.status).toBe(403);
      });

      it('/api/base/:baseId/collaborators (DELETE)', async () => {
        const res = await deleteBaseCollaborator({
          baseId,
          userId: newUser3Id,
        });
        expect(res.status).toBe(200);
        const collList = await getBaseCollaboratorList(baseId);
        expect(collList.data).toHaveLength(2);
      });

      it('/api/base/:baseId/collaborators (DELETE) - exceeds limit role', async () => {
        await updateBaseCollaborator({
          baseId,
          updateBaseCollaborateRo: {
            role: Role.Creator,
            userId: newUser3Id,
          },
        });
        const error = await getError(() =>
          deleteBaseCollaborator({
            baseId,
            userId: newUser3Id,
          })
        );
        expect(error?.status).toBe(403);
      });

      it('/api/base/:baseId/collaborators (DELETE) - self', async () => {
        await deleteBaseCollaborator({
          baseId: baseId,
          userId: globalThis.testConfig.userId,
        });
        const error = await getError(() => getBaseCollaboratorList(baseId));
        expect(error?.status).toBe(403);
      });
    });
  });
});
