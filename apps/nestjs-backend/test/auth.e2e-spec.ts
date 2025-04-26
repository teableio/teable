/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IGetTempTokenVo, IUserMeVo } from '@teable/openapi';
import {
  CHANGE_EMAIL,
  createAxios,
  GET_TEMP_TOKEN,
  SEND_CHANGE_EMAIL_CODE,
  sendSignupVerificationCode,
  SIGN_IN,
  signup,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { AUTH_SESSION_COOKIE_NAME } from '../src/const';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('Auth Controller (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  const authTestEmail = 'auth@test-auth.com';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prismaService = app.get(PrismaService);
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
        email: 'anonymous@system.teable.io',
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
      preEnableEmailVerification = await prismaService.setting
        .findFirst()
        .then((res) => res?.enableEmailVerification);
      await prismaService.setting.updateMany({
        data: { enableEmailVerification: true },
      });
    });

    afterEach(async () => {
      await prismaService.setting.updateMany({
        data: { enableEmailVerification: preEnableEmailVerification },
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
    const error = await getError(() => sendSignupVerificationCode('anonymous@system.teable.io'));
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
});
