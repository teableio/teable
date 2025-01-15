import type { INestApplication } from '@nestjs/common';
import { Role } from '@teable/core';
import type { CreateSpaceInvitationLinkVo } from '@teable/openapi';
import {
  ACCEPT_INVITATION_LINK,
  createSpace as apiCreateSpace,
  createSpaceInvitationLink as apiCreateSpaceInvitationLink,
  deleteSpace as apiDeleteSpace,
  getSpaceCollaboratorList as apiGetSpaceCollaboratorList,
  PrincipalType,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { initApp } from './utils/init-app';

describe('OpenAPI InvitationController (e2e)', () => {
  let app: INestApplication;
  let spaceId: string;
  let user2Request: AxiosInstance;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const res = await apiCreateSpace({ name: 'new space' });
    spaceId = res.data.id;

    user2Request = await createNewUserAxios({
      email: 'newuser@example.com',
      password: '12345678',
    });
  });

  afterAll(async () => {
    await apiDeleteSpace(spaceId);
    await app.close();
  });

  it('/api/invitation/link/accept (POST)', async () => {
    const invitationLinkRes = await apiCreateSpaceInvitationLink({
      spaceId,
      createSpaceInvitationLinkRo: { role: Role.Owner },
    });

    const { invitationId, invitationCode } = invitationLinkRes.data as CreateSpaceInvitationLinkVo;
    const data = await user2Request.post(ACCEPT_INVITATION_LINK, { invitationId, invitationCode });

    expect(data.data.spaceId).toEqual(spaceId);
    const { collaborators } = (await apiGetSpaceCollaboratorList(spaceId)).data;
    const collaborator = collaborators.find(
      (item) => item.type === PrincipalType.User && item.email === 'newuser@example.com'
    );
    expect(collaborator?.role).toEqual(Role.Owner);
  });
});
