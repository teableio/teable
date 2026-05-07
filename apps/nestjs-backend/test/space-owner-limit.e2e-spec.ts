/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { Role } from '@teable/core';
import type { ICreateSpaceVo, IUserMeVo } from '@teable/openapi';
import {
  CREATE_SPACE,
  EMAIL_SPACE_INVITATION,
  PERMANENT_DELETE_SPACE,
  UPDATE_SPACE_COLLABORATE,
  USER_ME,
  urlBuilder,
  PrincipalType,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

const MAX_OWNER_COUNT = 3;

describe('Space owner limit (e2e)', () => {
  let app: INestApplication;
  let preMaxSpaceOwnerCount: string | undefined;
  beforeAll(async () => {
    preMaxSpaceOwnerCount = process.env.MAX_SPACE_OWNER_COUNT;
    process.env.MAX_SPACE_OWNER_COUNT = String(MAX_OWNER_COUNT);
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    process.env.MAX_SPACE_OWNER_COUNT = preMaxSpaceOwnerCount;
    await app.close();
  });

  describe('createSpace limit', () => {
    let userRequest: AxiosInstance;
    const spaceIds: string[] = [];

    beforeAll(async () => {
      userRequest = await createNewUserAxios({
        email: 'owner-limit-create@example.com',
        password: '12345678',
      });
    });

    afterAll(async () => {
      for (const id of spaceIds) {
        await userRequest.delete(urlBuilder(PERMANENT_DELETE_SPACE, { spaceId: id }));
      }
    });

    it(`should allow creating up to ${MAX_OWNER_COUNT} spaces`, async () => {
      for (let i = 0; i < MAX_OWNER_COUNT; i++) {
        const res = await userRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
          name: `limit-test-space-${i}`,
        });
        expect(res.status).toBe(201);
        spaceIds.push(res.data.id);
      }
    });

    it(`should reject creating the ${MAX_OWNER_COUNT + 1}th space`, async () => {
      const error = await getError(() =>
        userRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
          name: 'one-too-many',
        })
      );
      expect(error?.status).toBe(400);
      expect(error?.message).toContain('Owned space limit exceeded');
    });

    it('should allow creating a new space after deleting one (deleted spaces do not count)', async () => {
      const deletedId = spaceIds.pop()!;
      await userRequest.delete(urlBuilder(PERMANENT_DELETE_SPACE, { spaceId: deletedId }));

      const res = await userRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
        name: 'replacement-space',
      });
      expect(res.status).toBe(201);
      spaceIds.push(res.data.id);
    });
  });

  describe('invite as owner limit', () => {
    let ownerRequest: AxiosInstance;
    let inviterRequest: AxiosInstance;
    const ownerSpaceIds: string[] = [];
    let inviterSpaceId: string;

    beforeAll(async () => {
      ownerRequest = await createNewUserAxios({
        email: 'owner-limit-invite-target@example.com',
        password: '12345678',
      });

      for (let i = 0; i < MAX_OWNER_COUNT; i++) {
        const res = await ownerRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
          name: `owned-space-${i}`,
        });
        ownerSpaceIds.push(res.data.id);
      }

      inviterRequest = await createNewUserAxios({
        email: 'owner-limit-inviter@example.com',
        password: '12345678',
      });
      const inviterSpace = await inviterRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
        name: 'inviter-space',
      });
      inviterSpaceId = inviterSpace.data.id;
    });

    afterAll(async () => {
      for (const id of ownerSpaceIds) {
        await ownerRequest.delete(urlBuilder(PERMANENT_DELETE_SPACE, { spaceId: id }));
      }
      await inviterRequest.delete(urlBuilder(PERMANENT_DELETE_SPACE, { spaceId: inviterSpaceId }));
    });

    it('should reject inviting a user as owner when they already own max spaces', async () => {
      const targetEmail = 'owner-limit-invite-target@example.com';
      const error = await getError(() =>
        inviterRequest.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId: inviterSpaceId }), {
          emails: [targetEmail],
          role: Role.Owner,
        })
      );
      expect(error?.status).toBe(400);
      expect(error?.message).toContain('Owned space limit exceeded');
    });

    it('should allow inviting the same user as a non-owner role', async () => {
      const targetEmail = 'owner-limit-invite-target@example.com';
      const res = await inviterRequest.post(
        urlBuilder(EMAIL_SPACE_INVITATION, { spaceId: inviterSpaceId }),
        {
          emails: [targetEmail],
          role: Role.Editor,
        }
      );
      expect(res.status).toBe(201);
    });
  });

  describe('promote to owner limit', () => {
    let ownerRequest: AxiosInstance;
    let promoterRequest: AxiosInstance;
    let targetUserId: string;
    const ownerSpaceIds: string[] = [];
    let promoterSpaceId: string;

    beforeAll(async () => {
      ownerRequest = await createNewUserAxios({
        email: 'owner-limit-promote-target@example.com',
        password: '12345678',
      });
      const meRes = await ownerRequest.get<IUserMeVo>(USER_ME);
      targetUserId = meRes.data.id;

      for (let i = 0; i < MAX_OWNER_COUNT; i++) {
        const res = await ownerRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
          name: `promote-owned-space-${i}`,
        });
        ownerSpaceIds.push(res.data.id);
      }

      promoterRequest = await createNewUserAxios({
        email: 'owner-limit-promoter@example.com',
        password: '12345678',
      });
      const promoterSpace = await promoterRequest.post<ICreateSpaceVo>(CREATE_SPACE, {
        name: 'promoter-space',
      });
      promoterSpaceId = promoterSpace.data.id;

      await promoterRequest.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId: promoterSpaceId }), {
        emails: ['owner-limit-promote-target@example.com'],
        role: Role.Editor,
      });
    });

    afterAll(async () => {
      for (const id of ownerSpaceIds) {
        await ownerRequest.delete(urlBuilder(PERMANENT_DELETE_SPACE, { spaceId: id }));
      }
      await promoterRequest.delete(
        urlBuilder(PERMANENT_DELETE_SPACE, { spaceId: promoterSpaceId })
      );
    });

    it('should reject promoting a user to owner when they already own max spaces', async () => {
      const error = await getError(() =>
        promoterRequest.patch(urlBuilder(UPDATE_SPACE_COLLABORATE, { spaceId: promoterSpaceId }), {
          role: Role.Owner,
          principalId: targetUserId,
          principalType: PrincipalType.User,
        })
      );
      expect(error?.status).toBe(400);
      expect(error?.message).toContain('Owned space limit exceeded');
    });
  });
});
