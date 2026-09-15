/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { DriverClient, generateAccountId, HttpErrorCode, Role } from '@teable/core';
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
  ISettingVo,
} from '@teable/openapi';
import {
  ADD_PIN,
  axios as openApiAxios,
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
  createSpace,
  createAxios,
  DELETE_BASE,
  DELETE_SPACE,
  DELETE_USER,
  EMAIL_SPACE_INVITATION,
  emailSpaceInvitation,
  GET_TEMP_TOKEN,
  permanentDeleteSpace,
  PrincipalType,
  PinType,
  PluginPosition,
  PluginStatus,
  SEND_CHANGE_EMAIL_CODE,
  sendSignupVerificationCode,
  sendSigninVerificationCode,
  SIGN_IN,
  SIGN_IN_WITH_CODE,
  signup,
  urlBuilder,
  UPDATE_SPACE_COLLABORATE,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { vi } from 'vitest';
import { CacheService } from '../src/cache/cache.service';
import { AUTH_SESSION_COOKIE_NAME } from '../src/const';
import { TeableJwtService } from '../src/features/auth/jwt/teable-jwt.service';
import { SettingService } from '../src/features/setting/setting.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('Auth Controller (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let settingService: SettingService;
  let originalGetSetting: ISettingVo;

  const authTestEmail = 'auth@test-auth.com';

  beforeAll(async () => {
    process.env.BACKEND_CHANGE_EMAIL_SEND_CODE_MAIL_RATE = '0';
    process.env.BACKEND_SIGNUP_VERIFICATION_SEND_CODE_MAIL_RATE = '0';
    process.env.BACKEND_RESET_PASSWORD_SEND_MAIL_RATE = '0';
    process.env.BACKEND_SIGNIN_VERIFICATION_MAX_ATTEMPTS = '3';

    const appCtx = await initApp();
    app = appCtx.app;
    prismaService = app.get(PrismaService);
    settingService = app.get(SettingService);
    originalGetSetting = await settingService.getSetting();
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

  describe('sign up with banned email domain', () => {
    beforeEach(() => {
      vi.spyOn(settingService, 'getSetting').mockImplementation(async () => {
        return {
          ...originalGetSetting,
          bannedEmailDomains: ['test-auth.com'],
        };
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('api/auth/signup - banned email domain', async () => {
      const error = await getError(() =>
        signup({
          email: authTestEmail,
          password: '12345678a',
        })
      );
      expect(error?.status).toBe(400);
      expect(error?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
    });

    it('api/auth/send-signup-verification-code - banned email domain', async () => {
      const error = await getError(() => sendSignupVerificationCode(authTestEmail));
      expect(error?.status).toBe(400);
      expect(error?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
    });

    it('api/auth/signup - banned email domain rejected before email verification', async () => {
      vi.spyOn(settingService, 'getSetting').mockImplementation(async () => {
        return {
          ...originalGetSetting,
          bannedEmailDomains: ['test-auth.com'],
          enableEmailVerification: true,
        };
      });

      // banned check must fire before the 422 verification-required flow
      // (which would have mailed a verification code to the banned domain)
      const error = await getError(() =>
        signup({
          email: authTestEmail,
          password: '12345678a',
        })
      );
      expect(error?.status).toBe(400);
      expect(error?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
    });
  });

  describe('sign up with email verification', () => {
    beforeEach(async () => {
      vi.spyOn(settingService, 'getSetting').mockImplementation(async () => {
        return {
          ...originalGetSetting,
          enableEmailVerification: true,
        };
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
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
      const jwtService = app.get(TeableJwtService);
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

  describe('sign in with email code', () => {
    const codeEmail = 'signin-code@test-auth.com';
    let cacheService: CacheService;

    const getCode = async () => {
      const cached = await cacheService.get(`auth:signin-code:${codeEmail}`);
      expect(cached?.code).toMatch(/^\d{6}$/);
      return cached!.code;
    };

    const anonymousAxios = () => {
      const instance = createAxios();
      instance.defaults.baseURL = openApiAxios.defaults.baseURL;
      return instance;
    };

    beforeAll(async () => {
      cacheService = app.get(CacheService);
      await createNewUserAxios({ email: codeEmail, password: '12345678a' });
    });

    afterAll(async () => {
      await prismaService.user.deleteMany({ where: { email: codeEmail } });
    });

    it('api/auth/send-signin-verification-code - not registered', async () => {
      const error = await getError(() =>
        sendSigninVerificationCode('nobody@test-signin-code-not-registered.com')
      );
      expect(error?.status).toBe(400);
    });

    it('api/auth/send-signin-verification-code - system email', async () => {
      const error = await getError(() => sendSigninVerificationCode('anonymous@system.teable.ai'));
      expect(error?.status).toBe(400);
    });

    it('api/auth/signin-with-code - signs in once and consumes the code', async () => {
      const sent = await sendSigninVerificationCode(codeEmail);
      expect(sent.data.expiresTime).not.toBeUndefined();
      const code = await getCode();

      const res = await anonymousAxios().post<IUserMeVo>(SIGN_IN_WITH_CODE, {
        email: codeEmail,
        code,
      });
      expect(res.status).toBe(200);
      expect(res.data.email).toBe(codeEmail);
      expect(res.headers['set-cookie']?.join(';')).toContain(AUTH_SESSION_COOKIE_NAME);

      const sessionAxios = anonymousAxios();
      sessionAxios.defaults.headers.Cookie = res.headers['set-cookie'] as unknown as string;
      const me = await sessionAxios.get<IUserMeVo>(USER_ME);
      expect(me.data.email).toBe(codeEmail);

      // One-time: the same code is rejected on replay.
      const replay = await getError(() =>
        anonymousAxios().post(SIGN_IN_WITH_CODE, { email: codeEmail, code })
      );
      expect(replay?.status).toBe(400);
      expect(replay?.code).toBe(HttpErrorCode.INVALID_CAPTCHA);
    });

    it('api/auth/signin-with-code - too many wrong guesses discard the code', async () => {
      await sendSigninVerificationCode(codeEmail);
      const code = await getCode();
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 3; i++) {
        const error = await getError(() =>
          anonymousAxios().post(SIGN_IN_WITH_CODE, { email: codeEmail, code: wrong })
        );
        expect(error?.status).toBe(400);
      }
      // The correct code no longer works after the guess budget is spent.
      const error = await getError(() =>
        anonymousAxios().post(SIGN_IN_WITH_CODE, { email: codeEmail, code })
      );
      expect(error?.status).toBe(400);

      // A fresh code resets the budget.
      await sendSigninVerificationCode(codeEmail);
      const fresh = await getCode();
      const res = await anonymousAxios().post<IUserMeVo>(SIGN_IN_WITH_CODE, {
        email: codeEmail,
        code: fresh,
      });
      expect(res.status).toBe(200);
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
      const jwtService = app.get(TeableJwtService);
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
        // The API no longer seeds default records (T6947); the comment below needs a row.
        records: [{ fields: {} }, { fields: {} }, { fields: {} }],
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
      scopes: ['record|read'],
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
        clientId: oauthAppClientId,
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

  it('api/auth/delete-user - need confirm', async () => {
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
  });

  it('api/auth/delete-user', async () => {
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
    // membership in someone else's space must not block deletion
    const otherSpace = await createSpace({ name: 'test-delete-user-other-space' });
    await emailSpaceInvitation({
      spaceId: otherSpace.data.id,
      emailSpaceInvitationRo: {
        emails: ['delete-user@test-delete-user.com'],
        role: Role.Editor,
      },
    });
    // a space the user owns alone: it is trashed together with the account
    const soloSpace = await userAxios.post(CREATE_SPACE, { name: 'test-delete-user-solo-space' });
    // the main space has another member: the user may hand it over instead
    await userAxios.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId: testData.spaceId }), {
      emails: [globalThis.testConfig.email],
      role: Role.Editor,
    });

    const error = await getError(() =>
      userAxios.delete(DELETE_USER, { params: { confirm: 'DELETE' } })
    );
    expect(error?.status).toBe(400);
    const errorData = error?.data as IDeleteUserErrorData;
    expect(errorData.spaces).toHaveLength(2);
    expect(errorData.spaces).toEqual(
      expect.arrayContaining([
        { id: testData.spaceId, name: 'test-delete-user-space', hasOtherMembers: true },
        { id: soloSpace.data.id, name: 'test-delete-user-solo-space', hasOtherMembers: false },
      ])
    );
    // nothing is touched on the user's behalf
    const soloBefore = await prismaService.space.findUniqueOrThrow({
      where: { id: soloSpace.data.id },
    });
    expect(soloBefore.deletedTime).toBeNull();

    // the user keeps the main space by handing it over, and acknowledges
    // that the solo space goes to trash together with the account
    await userAxios.patch(urlBuilder(UPDATE_SPACE_COLLABORATE, { spaceId: testData.spaceId }), {
      principalId: globalThis.testConfig.userId,
      principalType: PrincipalType.User,
      role: Role.Owner,
    });
    const res = await userAxios.delete(DELETE_USER, {
      params: { confirm: 'DELETE', spaceIds: [soloSpace.data.id] },
    });
    expect(res.status).toBe(200);
    // the handed-over and foreign spaces stay live, the solo one joins the
    // already trashed one to wait for the retention cleanup
    const spaces = await prismaService.space.findMany({
      where: {
        id: {
          in: [testData.spaceId, testData.deleteSpaceId, otherSpace.data.id, soloSpace.data.id],
        },
      },
      select: { id: true, deletedTime: true },
    });
    expect(spaces).toEqual(
      expect.arrayContaining([
        { id: testData.spaceId, deletedTime: null },
        { id: otherSpace.data.id, deletedTime: null },
        { id: testData.deleteSpaceId, deletedTime: expect.any(Date) },
        { id: soloSpace.data.id, deletedTime: expect.any(Date) },
      ])
    );
    const soloTrash = await prismaService.trash.findUnique({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        resourceType_resourceId: { resourceType: 'space', resourceId: soloSpace.data.id },
      },
    });
    expect(soloTrash?.deletedBy).toBe(testData.userId);
    const collaborators = await prismaService.collaborator.findMany({
      where: { principalId: testData.userId },
    });
    expect(collaborators).toEqual([]);
    await permanentDeleteSpace(testData.spaceId);
    await permanentDeleteSpace(otherSpace.data.id);
    // the trashed spaces lost their only owner, so clean them up directly
    const trashedSpaceIds = [testData.deleteSpaceId, soloSpace.data.id];
    await prismaService.trash.deleteMany({ where: { resourceId: { in: trashedSpaceIds } } });
    await prismaService.space.deleteMany({ where: { id: { in: trashedSpaceIds } } });
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
  });
});
