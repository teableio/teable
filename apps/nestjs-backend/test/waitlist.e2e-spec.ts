import type { INestApplication } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  inviteWaitlist,
  getWaitlist,
  joinWaitlist as joinWaitlistApi,
  signup,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { SettingService } from '../src/features/setting/setting.service';
import type { IClsStore } from '../src/types/cls';
import { initApp, runWithTestUser } from './utils/init-app';

describe('Auth Controller (e2e) api/auth waitlist', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let settingService: SettingService;
  let clsService: ClsService<IClsStore>;
  let enableWaitlist: boolean | null | undefined;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    clsService = app.get(ClsService);
    prismaService = app.get(PrismaService);
    settingService = app.get(SettingService);
    const setting = await settingService.getSetting();
    enableWaitlist = setting.enableWaitlist;
    await runWithTestUser(clsService, async () => {
      await settingService.updateSetting({
        enableWaitlist: true,
      });
    });
  });

  afterAll(async () => {
    await runWithTestUser(clsService, async () => {
      await settingService.updateSetting({
        enableWaitlist: enableWaitlist ?? false,
      });
    });
    await app.close();
  });

  const joinWaitlist = async (handler?: (email: string) => Promise<void>) => {
    const demoEmail = getRandomString(10) + '@demo.com';
    const res = await joinWaitlistApi({
      email: demoEmail,
    });
    expect(res.data.email).toBe(demoEmail);
    const item = await prismaService.waitlist.findFirst({
      where: {
        email: demoEmail,
      },
    });
    expect(item?.email).toBe(demoEmail);
    if (handler) {
      await handler(demoEmail);
    }

    await prismaService.waitlist.delete({
      where: {
        email: demoEmail,
      },
    });
  };

  it('api/auth/join-waitlist', async () => {
    await joinWaitlist();
  });

  it('api/auth/get-waitlist', async () => {
    await joinWaitlist(async (email) => {
      const res = await getWaitlist();
      const list = res.data.map((item) => item.email);
      expect(list).toContain(email);
    });
  });

  it('api/auth/approve-waitlist', async () => {
    await joinWaitlist(async (email) => {
      const res = await inviteWaitlist({
        list: [email],
      });
      // const mailSenderService = app.get(MailSenderService);
      // expect(mailSenderService.sendMail).toHaveBeenCalled();
      expect(res.data.length).toEqual(1);
      expect(res.data[0].email).toEqual(email);
      expect(res.data[0].code.length).toBeGreaterThan(0);
      expect(res.data[0].times).toBeGreaterThan(0);
    });
  });

  it('api/auth/join-waitlist - user already exist', async () => {
    const email = globalThis.testConfig.email;
    await expect(
      joinWaitlistApi({
        email,
      })
    ).rejects.toThrow();
  });

  it('api/auth/signup - invite code is not correct when waitlist is enabled', async () => {
    const fackCode = getRandomString(10);
    const demoEmail = getRandomString(10).toLowerCase() + '@local.com';
    const password = '12345678a';

    // no invite code
    await expect(
      signup({
        email: demoEmail,
        password,
      })
    ).rejects.toThrow();

    await joinWaitlistApi({
      email: demoEmail,
    });

    // invite code is not correct
    await expect(
      signup({
        email: demoEmail,
        password,
        inviteCode: fackCode,
      })
    ).rejects.toThrow();

    const res = await inviteWaitlist({
      list: [demoEmail],
    });
    expect(res.data.length).toEqual(1);
    expect(res.data[0].email).toEqual(demoEmail);
    const code = res.data[0].code;

    // invite code is correct
    const signupRes = await signup({
      email: demoEmail,
      password,
      inviteCode: code,
    });

    expect(signupRes.data.email).toBe(demoEmail);
    await prismaService.user.delete({
      where: { email: signupRes.data.email },
    });
  });
});
