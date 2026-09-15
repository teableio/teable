import type { INestApplication } from '@nestjs/common';
import { APP_ROBOT_ID, Role, getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  ACCEPT_INVITATION_LINK,
  CREATE_SPACE,
  CollaboratorType,
  GET_BASE_ALL,
  GET_SPACE_LIST,
  GET_TABLE_LIST,
  PrincipalType,
  axios,
  createAxios,
  createSpaceInvitationLink,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { AuthService } from '../src/features/auth/auth.service';
import { JwtAuthInternalType } from '../src/features/auth/strategies/types';
import { getError } from './utils/get-error';
import {
  createBase,
  createSpace,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
} from './utils/init-app';

// App tokens share the appRobot identity, so their authority must stay confined
// to the base signed into the token even when a collaborator row names appRobot.
describe('App robot permission isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let robotAxios: AxiosInstance;
  let ownBaseId: string;
  let foreignSpaceId: string;
  let foreignBaseId: string;

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);

    const [ownBase, foreignSpace] = await Promise.all([
      createBase({ spaceId: globalThis.testConfig.spaceId, name: 'robot own' }),
      createSpace({ name: 'robot foreign space' }),
    ]);
    ownBaseId = ownBase.id;
    foreignSpaceId = foreignSpace.id;
    const [foreignBase, { accessToken }] = await Promise.all([
      createBase({ spaceId: foreignSpaceId, name: 'robot foreign' }),
      app.get(AuthService).getTempInternalToken(ownBaseId, JwtAuthInternalType.App),
    ]);
    foreignBaseId = foreignBase.id;

    robotAxios = createAxios();
    robotAxios.defaults.baseURL = axios.defaults.baseURL;
    robotAxios.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
  });

  afterAll(async () => {
    await Promise.all([permanentDeleteSpace(foreignSpaceId), permanentDeleteBase(ownBaseId)]);
    await app.close();
  });

  it('cannot create a space', async () => {
    const error = await getError(() => robotAxios.post(CREATE_SPACE, { name: 'robot space' }));
    expect(error?.status).toBe(403);
  });

  it('cannot accept an invitation link', async () => {
    const { invitationId, invitationCode } = (
      await createSpaceInvitationLink({
        spaceId: foreignSpaceId,
        createSpaceInvitationLinkRo: { role: Role.Owner },
      })
    ).data;

    const error = await getError(() =>
      robotAxios.post(ACCEPT_INVITATION_LINK, { invitationId, invitationCode })
    );
    expect(error?.status).toBe(403);
    expect(
      await prisma.collaborator.count({
        where: { resourceId: foreignSpaceId, principalId: APP_ROBOT_ID },
      })
    ).toBe(0);
  });

  describe('with a stray appRobot owner row on a foreign space', () => {
    beforeAll(async () => {
      await prisma.collaborator.create({
        data: {
          id: getRandomString(16),
          resourceId: foreignSpaceId,
          resourceType: CollaboratorType.Space,
          roleName: Role.Owner,
          principalId: APP_ROBOT_ID,
          principalType: PrincipalType.User,
          createdBy: APP_ROBOT_ID,
        },
      });
    });

    it('still cannot read the foreign base', async () => {
      const error = await getError(() =>
        robotAxios.get(urlBuilder(GET_TABLE_LIST, { baseId: foreignBaseId }))
      );
      expect(error?.status).toBe(403);
    });

    it('cannot list spaces or bases across tenants', async () => {
      const [spaceError, baseError] = await Promise.all([
        getError(() => robotAxios.get(GET_SPACE_LIST)),
        getError(() => robotAxios.get(GET_BASE_ALL)),
      ]);
      expect(spaceError?.status).toBe(403);
      expect(baseError?.status).toBe(403);
    });

    it('still reads its own base', async () => {
      const res = await robotAxios.get(urlBuilder(GET_TABLE_LIST, { baseId: ownBaseId }));
      expect(res.status).toBe(200);
    });
  });
});
