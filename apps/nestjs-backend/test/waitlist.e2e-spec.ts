import type { INestApplication } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { inviteWaitlist, getWaitlist, joinWaitlist as joinWaitlistApi } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { LocalAuthService } from '../src/features/auth/local-auth/local-auth.service';
import { SettingService } from '../src/features/setting/setting.service';
import type { IClsStore } from '../src/types/cls';
import { initApp, runWithTestUser } from './utils/init-app';

describe('Auth Controller (e2e) api/auth waitlist', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let settingService: SettingService;
  let clsService: ClsService<IClsStore>;
  let authService: LocalAuthService;
  let enableWaitlist: boolean | null | undefined;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    clsService = app.get(ClsService);
    prismaService = app.get(PrismaService);
    settingService = app.get(SettingService);
    authService = app.get(LocalAuthService);
    const setting = await settingService.getSetting();
    enableWaitlist = setting.enableWaitlist;
    await runWithTestUser(clsService, async () => {
      await settingService.updateSetting({
        enableWaitlist: null,
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
    const demoEmail = getRandomString(10) + '@demo.com';
    const approved1 = await authService.checkWaitlistInviteCode(fackCode);
    expect(approved1).toBe(true);

    await runWithTestUser(clsService, async () => {
      await settingService.updateSetting({
        enableWaitlist: true,
      });
    });

    await expect(authService.checkWaitlistInviteCode(fackCode)).rejects.toThrow();

    await joinWaitlistApi({
      email: demoEmail,
    });

    await expect(authService.checkWaitlistInviteCode(fackCode)).rejects.toThrow();

    const res = await inviteWaitlist({
      list: [demoEmail],
    });
    expect(res.data.length).toEqual(1);
    expect(res.data[0].email).toEqual(demoEmail);
    const code = res.data[0].code;

    const approved2 = await authService.checkWaitlistInviteCode(code);
    expect(approved2).toBe(true);
  });
});
