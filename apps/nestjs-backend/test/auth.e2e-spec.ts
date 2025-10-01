/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DriverClient, generateAccountId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  CreateAccessTokenVo,
  CreateSpaceInvitationLinkVo,
  ICommentVo,
  ICreateCommentRo,
  ICreatePluginVo,
  IDeleteUserErrorData,
  IGetTempTokenVo,
  ITableFullVo,
  IUserMeVo,
} from '@teable/openapi';
import {
  ADD_PIN,
  CHANGE_EMAIL,
  CommentNodeType,
  CREATE_ACCESS_TOKEN,
  CREATE_BASE,
  CREATE_COMMENT,
  CREATE_COMMENT_SUBSCRIBE,
  CREATE_PLUGIN,
  CREATE_SPACE,
  CREATE_SPACE_INVITATION_LINK,
  CREATE_TABLE,
  createAxios,
  DELETE_BASE,
  DELETE_SPACE,
  DELETE_USER,
  GET_TEMP_TOKEN,
  PERMANENT_DELETE_SPACE,
  PinType,
  PluginPosition,
  PluginStatus,
  SEND_CHANGE_EMAIL_CODE,
  sendSignupVerificationCode,
  SIGN_IN,
  signup,
  urlBuilder,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { ClsService } from 'nestjs-cls';
import { AUTH_SESSION_COOKIE_NAME } from '../src/const';
import { SettingService } from '../src/features/setting/setting.service';
import type { IClsStore } from '../src/types/cls';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp, runWithTestUser } from './utils/init-app';

describe('Auth Controller (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let settingService: SettingService;
  let clsService: ClsService<IClsStore>;
  const authTestEmail = 'auth@test-auth.com';

  beforeAll(async () => {
    // Disable signup verification code rate limit for E2E tests
    process.env.BACKEND_SIGNUP_VERIFICATION_CODE_RATE_LIMIT_SECONDS = '0';

    const appCtx = await initApp();
    app = appCtx.app;
    clsService = app.get(ClsService);
    prismaService = app.get(PrismaService);
    settingService = app.get(SettingService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prismaService.user.deleteMany({ where: { email: authTestEmail } });
  });

  it('api/auth/signup - password min length', async () => {
    const error = await getError(() =>
      signup({
        email: authTestEmail,
        password: '123456',
      })
    );
    expect(error?.status).toBe(400);
  });

  it('api/auth/signup - password include letter and number', async () => {
    const error = await getError(() =>
      signup({
        email: authTestEmail,
        password: '12345678',
      })
    );
    expect(error?.status).toBe(400);
  });

  it('api/auth/signup - email is already registered', async () => {
    const error = await getError(() =>
      signup({
        email: globalThis.testConfig.email,
        password: '12345678a',
      })
    );
    expect(error?.status).toBe(409);
  });

  it('api/auth/signup - system email', async () => {
    const error = await getError(() =>
      signup({
        email: 'anonymous@system.teable.ai',
        password: '12345678a',
      })
    );
    expect(error?.status).toBe(400);
  });

  it('api/auth/signup - invite email', async () => {
    await prismaService.user.create({
      data: {
        email: 'invite@test-invite-signup.com',
        name: 'Invite',
      },
    });
    const res = await signup({
      email: 'invite@test-invite-signup.com',
      password: '12345678a',
    });
    expect(res.status).toBe(201);
    await prismaService.user.delete({
      where: { email: 'invite@test-invite-signup.com' },
    });
  });

  describe('sign up with email verification', () => {
    let preEnableEmailVerification: boolean | null | undefined;
    beforeEach(async () => {
      await runWithTestUser(clsService, async () => {
        const setting = await settingService.getSetting();
        preEnableEmailVerification = setting.enableEmailVerification;
        await settingService.updateSetting({
          enableEmailVerification: true,
        });
      });
    });

    afterEach(async () => {
      await runWithTestUser(clsService, async () => {
        await settingService.updateSetting({
          enableEmailVerification: preEnableEmailVerification,
        });
      });
    });

    it('api/auth/signup - email verification is required', async () => {
      const error = await getError(() =>
        signup({
          email: authTestEmail,
          password: '12345678a',
        })
      );
      expect(error?.status).toBe(422);
    });

    it('api/auth/signup - email verification is invalid', async () => {
      const error = await getError(() =>
        signup({
          email: authTestEmail,
          password: '12345678a',
          verification: {
            token: 'invalid',
            code: 'invalid',
          },
        })
      );
      expect(error?.status).toBe(400);
    });

    it('api/auth/signup - email verification success', async () => {
      const error = await getError(() =>
        signup({
          email: authTestEmail,
          password: '12345678a',
        })
      );
      expect(error?.data).not.toBeUndefined();
      const data = error?.data as { token: string; expiresTime: number };
      expect(data.token).not.toBeUndefined();
      expect(data.expiresTime).not.toBeUndefined();
      const jwtService = app.get(JwtService);
      const decoded = await jwtService.verifyAsync<{ email: string; code: string }>(data.token);
      const res = await signup({
        email: authTestEmail,
        password: '12345678a',
        verification: {
          token: data.token,
          code: decoded.code,
        },
      });
      expect(res.data.email).toBe(authTestEmail);
    });
  });

  it('api/auth/send-signup-verification-code', async () => {
    const res = await sendSignupVerificationCode(authTestEmail);
    expect(res.data.token).not.toBeUndefined();
    expect(res.data.expiresTime).not.toBeUndefined();
  });

  it('api/auth/send-signup-verification-code - registered email', async () => {
    const error = await getError(() => sendSignupVerificationCode(globalThis.testConfig.email));
    expect(error?.status).toBe(409);
  });

  it('api/auth/send-signup-verification-code - system email', async () => {
    const error = await getError(() => sendSignupVerificationCode('anonymous@system.teable.ai'));
    expect(error?.status).toBe(400);
  });

  it('api/auth/send-signup-verification-code - invite email', async () => {
    const inviteEmail = 'invite@test-invite-signup-verification-code.com';
    await prismaService.user.create({
      data: {
        email: inviteEmail,
        name: 'Invite',
      },
    });
    const res = await sendSignupVerificationCode(inviteEmail);
    expect(res.status).toBe(200);
    await prismaService.user.delete({
      where: { email: inviteEmail },
    });
  });

  describe('change email', () => {
    const changeEmail = 'change-email@test-change-email.com';
    const changedEmail = 'changed-email@test-changed-email.com';
    let changeEmailAxios: AxiosInstance;

    beforeEach(async () => {
      changeEmailAxios = await createNewUserAxios({
        email: changeEmail,
        password: '12345678a',
      });
    });

    afterEach(async () => {
      await prismaService.user.deleteMany({ where: { email: changeEmail } });
      await prismaService.user.deleteMany({ where: { email: changedEmail } });
    });

    it('api/auth/send-change-email-code - new email is already registered', async () => {
      const error = await getError(() =>
        changeEmailAxios.post(SEND_CHANGE_EMAIL_CODE, {
          email: globalThis.testConfig.email,
          password: '12345678a',
        })
      );
      expect(error?.status).toBe(409);
    });

    it('api/auth/send-change-email-code - password is incorrect', async () => {
      const error = await getError(() =>
        changeEmailAxios.post(SEND_CHANGE_EMAIL_CODE, {
          email: changedEmail,
          password: '12345678',
        })
      );
      expect(error?.code).toBe(HttpErrorCode.INVALID_CREDENTIALS);
    });

    it('api/auth/send-change-email-code - same email', async () => {
      const error = await getError(() =>
        changeEmailAxios.post(SEND_CHANGE_EMAIL_CODE, {
          email: changeEmail,
          password: '12345678a',
        })
      );
      expect(error?.code).toBe(HttpErrorCode.CONFLICT);
    });

    it('api/auth/change-email', async () => {
      const codeRes = await changeEmailAxios.post(SEND_CHANGE_EMAIL_CODE, {
        email: changedEmail,
        password: '12345678a',
      });
      expect(codeRes.data.token).not.toBeUndefined();
      const jwtService = app.get(JwtService);
      const decoded = await jwtService.verifyAsync<{ email: string; code: string }>(
        codeRes.data.token
      );
      const newChangeEmailAxios = await createNewUserAxios({
        email: changeEmail,
        password: '12345678a',
      });
      const changeRes = await newChangeEmailAxios.patch(CHANGE_EMAIL, {
        email: changedEmail,
        token: codeRes.data.token,
        code: decoded.code,
      });
      expect(JSON.stringify(changeRes.headers['set-cookie'])).toContain(
        `"${AUTH_SESSION_COOKIE_NAME}=;`
      );
      const newAxios = axios.create({
        baseURL: codeRes.config.baseURL,
      });
      const res = await newAxios.post(SIGN_IN, {
        email: changedEmail,
        password: '12345678a',
      });
      expect(res.data.email).toBe(changedEmail);
    });

    it('api/auth/change-email - token is invalid', async () => {
      const error = await getError(() =>
        changeEmailAxios.patch(CHANGE_EMAIL, {
          email: changedEmail,
          token: 'invalid',
          code: 'invalid',
        })
      );
      expect(error?.code).toBe(HttpErrorCode.INVALID_CAPTCHA);
    });

    it('api/auth/change-email - code is invalid', async () => {
      const codeRes = await changeEmailAxios.post(SEND_CHANGE_EMAIL_CODE, {
        email: changedEmail,
        password: '12345678a',
      });
      const error = await getError(() =>
        changeEmailAxios.patch(CHANGE_EMAIL, {
          email: changedEmail,
          token: codeRes.data.token,
          code: 'invalid',
        })
      );
      expect(error?.code).toBe(HttpErrorCode.INVALID_CAPTCHA);
    });
  });

  it('api/auth/temp-token', async () => {
    const userAxios = await createNewUserAxios({
      email: 'temp-token@test-temp-token.com',
      password: '12345678',
    });
    const res = await userAxios.get<IGetTempTokenVo>(GET_TEMP_TOKEN);
    expect(res.data.accessToken).not.toBeUndefined();
    expect(res.data.expiresTime).not.toBeUndefined();
    const newAxios = createAxios();
    newAxios.interceptors.request.use((config) => {
      config.headers.Authorization = `Bearer ${res.data.accessToken}`;
      config.baseURL = res.config.baseURL;
      return config;
    });
    const userRes = await newAxios.get<IUserMeVo>(USER_ME);
    expect(userRes.data.email).toBe('temp-token@test-temp-token.com');
  });

  const createTestDataForDeleteUser = async (
    userAxios: AxiosInstance,
    prismaService: PrismaService
  ) => {
    const user = await userAxios.get<IUserMeVo>(USER_ME);
    const userId = user.data.id;
    // create space
    const spaceRes = await userAxios.post(CREATE_SPACE, {
      name: 'test-delete-user-space',
    });
    const spaceId = spaceRes.data.id;
    const space2 = await userAxios.post(CREATE_SPACE, {
      name: 'test-delete-user-space-2',
    });
    const deleteSpaceId = space2.data.id;
    await userAxios.delete(
      urlBuilder(DELETE_SPACE, {
        spaceId: space2.data.id,
      })
    );
    // create base
    const baseRes = await userAxios.post(CREATE_BASE, {
      name: 'test-delete-user-base',
      spaceId,
    });
    const baseId = baseRes.data.id;
    const createBase2 = await userAxios.post(CREATE_BASE, {
      name: 'test-delete-user-base-2',
      spaceId,
    });
    await userAxios.delete(
      urlBuilder(DELETE_BASE, {
        baseId: createBase2.data.id,
      })
    );
    const deleteBaseId = createBase2.data.id;

    const table = await userAxios.post<ITableFullVo>(
      urlBuilder(CREATE_TABLE, {
        baseId,
      }),
      {
        name: 'test-delete-user-table',
      }
    );
    const tableId = table.data.id;
    const recordId = table.data.records[0].id;
    const comment = await userAxios.post<ICommentVo>(
      urlBuilder(CREATE_COMMENT, {
        tableId,
        recordId,
      }),
      {
        content: [
          {
            type: CommentNodeType.Paragraph,
            children: [
              {
                type: CommentNodeType.Text,
                value: 'test-delete-user-comment',
              },
            ],
          },
        ],
      } as ICreateCommentRo
    );
    const commentId = comment.data.id;

    // token
    const tokenRes = await userAxios.post<CreateAccessTokenVo>(CREATE_ACCESS_TOKEN, {
      name: 'test-delete-user-token',
      scopes: ['record:read'],
      expiredTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    });
    const accessTokenId = tokenRes.data.id;
    // create account
    await prismaService.account.create({
      data: {
        id: generateAccountId(),
        userId,
        type: 'access_token',
        provider: 'teable',
        providerId: 'test-delete-user-token-' + new Date().getTime(),
      },
    });

    // create comment subscribe
    await userAxios.post(urlBuilder(CREATE_COMMENT_SUBSCRIBE, { tableId, recordId }));
    // create invitation
    const invitation = await userAxios.post<CreateSpaceInvitationLinkVo>(
      urlBuilder(CREATE_SPACE_INVITATION_LINK, { spaceId }),
      {
        role: 'owner',
      }
    );
    const invitationId = invitation.data.invitationId;
    // create invitation record
    const invitationRecord = await prismaService.invitationRecord.create({
      data: {
        invitationId,
        spaceId,
        type: 'link',
        inviter: userId,
        accepter: 'xxxxxx',
      },
      select: {
        id: true,
      },
    });
    const invitationRecordId = invitationRecord.id;

    // OAuthApp
    const oauthAppClientId = 'test-delete-user-oauth-app-' + new Date().getTime();
    await prismaService.oAuthApp.create({
      data: {
        name: 'delete-user-oauth-app',
        clientId: oauthAppClientId,
        createdBy: userId,
        homepage: 'https://test-delete-user-oauth-app.com',
      },
    });
    await prismaService.oAuthAppAuthorized.create({
      data: {
        clientId: oauthAppClientId,
        userId,
        authorizedTime: new Date().toISOString(),
      },
    });
    const oauthAppSecret = await prismaService.oAuthAppSecret.create({
      data: {
        clientId: oauthAppClientId,
        secret: 'delete-user-oauth-app-secret-' + new Date().getTime(),
        maskedSecret: 'delete-user-oauth-app-secret-' + new Date().getTime(),
        createdBy: userId,
      },
    });
    const oauthAppSecretId = oauthAppSecret.id;
    await prismaService.oAuthAppToken.create({
      data: {
        appSecretId: oauthAppSecretId,
        refreshTokenSign: 'delete-user-oauth-app-refresh-token-sign-' + new Date().getTime(),
        expiredTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        createdBy: userId,
      },
    });

    // pin space
    await userAxios.post(ADD_PIN, {
      id: spaceId,
      type: PinType.Space,
    });
    const pinSpaceId = spaceId;

    // plugin
    const plugin = await userAxios.post<ICreatePluginVo>(CREATE_PLUGIN, {
      name: 'delete-user-plugin',
      logo: 'https://test-delete-user-plugin.com/logo.png',
      positions: [PluginPosition.Dashboard],
    });
    const developingPluginId = plugin.data.id;
    const publishedPlugin = await userAxios.post<ICreatePluginVo>(CREATE_PLUGIN, {
      name: 'pub-user-plugin',
      logo: 'https://test-delete-user-plugin.com/logo.png',
      positions: [PluginPosition.Dashboard],
    });
    const publishedPluginId = publishedPlugin.data.id;
    await prismaService.plugin.update({
      where: { id: publishedPluginId },
      data: {
        status: PluginStatus.Published,
      },
    });

    return {
      spaceId,
      baseId,
      tableId,
      recordId,
      commentId,
      deleteBaseId,
      deleteSpaceId,
      accessTokenId,
      invitationId,
      invitationRecordId,
      oauthAppClientId,
      oauthAppSecretId,
      developingPluginId,
      publishedPluginId,
      pinSpaceId,
      userId,
    };
  };

  it.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
    'api/auth/delete-user - need confirm',
    async () => {
      const userAxios = await createNewUserAxios({
        email: 'delete-user@test-delete-user.com',
        password: '12345678',
      });
      const error = await getError(() => userAxios.delete(DELETE_USER));
      expect(error?.status).toBe(400);
      expect(error?.message).toContain('confirm');
      const error2 = await getError(() =>
        userAxios.delete(DELETE_USER, { params: { confirm: 'DELETE1' } })
      );
      expect(error2?.status).toBe(400);
      expect(error2?.message).toContain('Please enter DELETE to confirm');
    }
  );

  it.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
    'api/auth/delete-user',
    async () => {
      await prismaService.user.deleteMany({
        where: {
          email: 'delete-user@test-delete-user.com',
        },
      });
      const userAxios = await createNewUserAxios({
        email: 'delete-user@test-delete-user.com',
        password: '12345678',
      });
      const testData = await createTestDataForDeleteUser(userAxios, prismaService);
      const error = await getError(() =>
        userAxios.delete(DELETE_USER, { params: { confirm: 'DELETE' } })
      );
      expect(error?.status).toBe(400);
      const errorData = error?.data as IDeleteUserErrorData;
      expect(errorData.spaces.length).toBe(2);
      expect(errorData.spaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: testData.deleteSpaceId,
            deletedTime: expect.any(String),
          }),
          expect.objectContaining({
            id: testData.spaceId,
            deletedTime: null,
          }),
        ])
      );
      for (const space of errorData.spaces) {
        const spaceRes = await userAxios.delete(
          urlBuilder(PERMANENT_DELETE_SPACE, { spaceId: space.id })
        );
        expect(spaceRes.status).toBe(200);
      }
      const res = await userAxios.delete(DELETE_USER, { params: { confirm: 'DELETE' } });
      expect(res.status).toBe(200);
      // validate data
      // token
      const tokenRes = await prismaService.accessToken.findFirst({
        where: {
          id: testData.accessTokenId,
        },
      });
      expect(tokenRes).toBeNull();
      // account
      const accountRes = await prismaService.account.findFirst({
        where: {
          id: testData.accessTokenId,
        },
      });
      expect(accountRes).toBeNull();
      // comment subscribe
      const commentSubscribeRes = await prismaService.commentSubscription.findFirst({
        where: {
          createdBy: testData.userId,
        },
      });
      expect(commentSubscribeRes).toBeNull();
      // invitation
      const invitationRes = await prismaService.invitation.findFirst({
        where: {
          id: testData.invitationId,
        },
      });
      expect(invitationRes).toBeNull();
      // invitation record
      const invitationRecordRes = await prismaService.invitationRecord.findFirst({
        where: {
          id: testData.invitationRecordId,
        },
      });
      expect(invitationRecordRes).toBeNull();
      // OAuthApp
      const oauthAppRes = await prismaService.oAuthApp.findFirst({
        where: {
          clientId: testData.oauthAppClientId,
        },
      });
      expect(oauthAppRes).toBeNull();
      // OAuthAppSecret
      const oauthAppSecretRes = await prismaService.oAuthAppSecret.findFirst({
        where: {
          id: testData.oauthAppSecretId,
        },
      });
      expect(oauthAppSecretRes).toBeNull();
      // OAuthAppToken
      const oauthAppTokenRes = await prismaService.oAuthAppToken.findFirst({
        where: {
          appSecretId: testData.oauthAppSecretId,
        },
      });
      expect(oauthAppTokenRes).toBeNull();
      // pin space
      const pinSpaceRes = await prismaService.pinResource.findFirst({
        where: {
          resourceId: testData.pinSpaceId,
        },
      });
      expect(pinSpaceRes).toBeNull();
      // plugin
      const developingPluginRes = await prismaService.plugin.findFirst({
        where: {
          id: testData.developingPluginId,
        },
      });
      expect(developingPluginRes).toBeNull();
      const publishedPluginRes = await prismaService.plugin.findFirst({
        where: {
          id: testData.publishedPluginId,
        },
      });
      expect(publishedPluginRes).toBeDefined();
      await prismaService.plugin.delete({
        where: {
          id: testData.publishedPluginId,
        },
      });
      // user
      const userRes = await prismaService.user.findFirst({
        where: {
          id: testData.userId,
          name: 'Deleted User',
          permanentDeletedTime: {
            not: null,
          },
          deletedTime: {
            not: null,
          },
        },
      });
      expect(userRes).toBeDefined();
    }
  );
});
