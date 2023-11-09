/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { SpaceRole } from '@teable-group/core';
import type { CreateSpaceInvitationLinkVo, ListSpaceCollaboratorVo } from '@teable-group/openapi';
import type request from 'supertest';
import { getUserRequest, initApp } from './utils/init-app';

describe('OpenAPI InvitationController (e2e)', () => {
  let app: INestApplication;
  let request: request.SuperAgentTest;
  let spaceId: string;
  let user2Request: request.SuperAgentTest;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;

    const res = await request.post('/api/space').send({ name: 'new space' }).expect(201);
    spaceId = res.body.id;
    user2Request = await getUserRequest(appCtx.app, {
      email: 'newuser@example.com',
      password: '12345678',
    });
  });

  afterAll(async () => {
    await request.delete(`/api/space/${spaceId}`);
    await app.close();
  });

  it('/api/invitation/link/accept (POST)', async () => {
    const invitationLinkRes = await request
      .post(`/api/space/${spaceId}/invitation/link`)
      .send({ role: SpaceRole.Owner })
      .expect(201);
    const { invitationId, invitationCode } = invitationLinkRes.body as CreateSpaceInvitationLinkVo;
    const data = await user2Request
      .post('/api/invitation/link/accept')
      .send({ invitationId, invitationCode })
      .expect(201);

    expect(data.body.spaceId).toEqual(spaceId);
    const collaborators: ListSpaceCollaboratorVo = (
      await request.get(`/api/space/${spaceId}/collaborators`).expect(200)
    ).body;
    const collaborator = collaborators.find(({ email }) => email === 'newuser@example.com');
    expect(collaborator?.role).toEqual(SpaceRole.Owner);
  });
});
