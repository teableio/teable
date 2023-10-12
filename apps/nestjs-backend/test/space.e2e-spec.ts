/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { IdPrefix, SpaceRole } from '@teable-group/core';
import type { ListSpaceCollaboratorVo, ListSpaceInvitationLinkVo } from '@teable-group/openapi';
import { createSpaceInvitationLinkVoSchema, getSpaceVoSchema } from '@teable-group/openapi';
import request from 'supertest';
import { initApp } from './utils/init-app';

const testRequest = request;

describe('OpenAPI SpaceController (e2e)', () => {
  let app: INestApplication;
  let request: request.SuperAgentTest;
  const globalSpaceId: string = testConfig.spaceId;
  let spaceId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;

    const res = await request.post('/api/space').send({ name: 'new space' }).expect(201);
    spaceId = res.body.id;
  });

  afterAll(async () => {
    await request.delete(`/api/space/${spaceId}`);
    await app.close();
  });

  it('/api/space (POST)', async () => {
    expect(spaceId.startsWith(IdPrefix.Space)).toEqual(true);
  });

  it('/api/space/:spaceId (PUT)', async () => {
    const res = await request
      .patch(`/api/space/${spaceId}`)
      .send({ name: 'new space1' })
      .expect(200);
    spaceId = res.body.id;
    expect(res.body.name).toEqual('new space1');
  });

  it('/api/space/:spaceId (GET)', async () => {
    const res = await request.get(`/api/space/${globalSpaceId}`).expect(200);
    expect(getSpaceVoSchema.safeParse(res.body).success).toEqual(true);
  });

  it('/api/space (GET)', async () => {
    const res = await request.get('/api/space').expect(200);
    expect(res.body.length > 0).toEqual(true);
  });

  it('/api/space/:spaceId (DELETE)', async () => {
    const newSpaceRes = await request.post('/api/space').send({ name: 'delete space' }).expect(201);
    await request.delete(`/api/space/${newSpaceRes.body.id}`).expect(200);
    await request.get(`/api/space/${newSpaceRes.body.id}`).expect(404);
  });

  it('/api/space/:spaceId/collaborators (GET)', async () => {
    const collaborators: ListSpaceCollaboratorVo = (
      await request.get(`/api/space/${spaceId}/collaborators`).expect(200)
    ).body;
    expect(collaborators).toHaveLength(1);
  });

  describe('Space Invitation', () => {
    const newUserEmail = 'newuser@example.com';

    beforeEach(async () => {
      await testRequest(app.getHttpServer()).post('/api/auth/signup').send({
        email: newUserEmail,
        password: '12345678',
      });
    });

    it('/api/space/:spaceId/invitation/link (POST)', async () => {
      const res = await request
        .post(`/api/space/${spaceId}/invitation/link`)
        .send({ role: SpaceRole.Owner })
        .expect(201);
      expect(createSpaceInvitationLinkVoSchema.safeParse(res.body).success).toEqual(true);
    });

    it('/api/space/:spaceId/invitation/link/:invitationId (PATCH)', async () => {
      const res = await request
        .post(`/api/space/${spaceId}/invitation/link`)
        .send({ role: SpaceRole.Owner })
        .expect(201);
      const newInvitationId = res.body.invitationId;
      const newSpaceUpdate = await request
        .patch(`/api/space/${spaceId}/invitation/link/${newInvitationId}`)
        .send({ role: SpaceRole.Editor })
        .expect(200);

      expect(newSpaceUpdate.body.role).toEqual(SpaceRole.Editor);

      await request.delete(`/api/space/${spaceId}/invitation/link/${newInvitationId}`).expect(200);
    });

    it('/api/space/:spaceId/invitation/link (GET)', async () => {
      const res = await request.get(`/api/space/${spaceId}/invitation/link`).expect(200);
      expect(res.body.length > 0).toEqual(true);
    });

    it('/api/space/:spaceId/invitation/link/:invitationId (DELETE)', async () => {
      const res = await request
        .post(`/api/space/${spaceId}/invitation/link`)
        .send({ role: SpaceRole.Owner })
        .expect(201);
      const newInvitationId = res.body.invitationId;
      await request.delete(`/api/space/${spaceId}/invitation/link/${newInvitationId}`).expect(200);
      const list: ListSpaceInvitationLinkVo = (
        await request.get(`/api/space/${spaceId}/invitation/link`).expect(200)
      ).body;

      expect(list.findIndex((v) => v.invitationId === newInvitationId) < 0).toEqual(true);
    });

    it('/api/space/:spaceId/invitation/email (POST)', async () => {
      await request
        .post(`/api/space/${spaceId}/invitation/email`)
        .send({ role: SpaceRole.Owner, emails: [newUserEmail] })
        .expect(201);

      const collaborators: ListSpaceCollaboratorVo = (
        await request.get(`/api/space/${spaceId}/collaborators`).expect(200)
      ).body;

      const newCollaboratorInfo = collaborators.find(({ email }) => email === newUserEmail);

      expect(newCollaboratorInfo).not.toBeUndefined();
      expect(newCollaboratorInfo?.role).toEqual(SpaceRole.Owner);
    });
  });
});
