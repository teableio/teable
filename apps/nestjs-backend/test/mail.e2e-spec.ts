import type { INestApplication } from '@nestjs/common';
import type { ISetSettingMailTransportConfigRo, ITestMailTransportConfigRo } from '@teable/openapi';
import {
  MailTransporterType,
  MailType,
  setSettingMailTransportConfig,
  SettingKey,
  testMailTransportConfig,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { MailSenderService } from '../src/features/mail-sender/mail-sender.service';
import { initApp } from './utils/init-app';

const mockMailTransportConfig = {
  sender: 'xxx',
  senderName: 'TestSender',
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: 'xxx',
    pass: 'xxx',
  },
};

const mockMailTo = 'demo@teable.io';

const mockMailOptions = () => ({
  to: mockMailTo,
  title: 'Test',
  message: 'hi, this is a test mail at ' + dayjs().format('YYYY-MM-DD HH:mm:ss'),
  buttonUrl: 'https://teable.ai',
  buttonText: 'Text',
});

describe.skip('Mail sender  (e2e)', () => {
  let app: INestApplication;
  let mailSenderService: MailSenderService;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    mailSenderService = app.get(MailSenderService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should test mail transporter', async () => {
    const ro: ITestMailTransportConfigRo = {
      to: mockMailTo,
      message: mockMailOptions().message,
      transportConfig: mockMailTransportConfig,
    };

    await testMailTransportConfig(ro);
  });

  it('should send mail by transport config', async () => {
    const commonEmailOptions = await mailSenderService.htmlEmailOptions(mockMailOptions());
    const mailOptions = {
      transporterName: MailTransporterType.Notify,
      to: mockMailTo,
      ...commonEmailOptions,
    };

    const sendRes = await mailSenderService.sendMail(mailOptions, {
      transportConfig: mockMailTransportConfig,
    });
    expect(sendRes).toBe(true);
  });

  it('should save setting mail transporter and send mail', async () => {
    const ro: ISetSettingMailTransportConfigRo = {
      name: SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG,
      transportConfig: mockMailTransportConfig,
    };

    const setRes = await setSettingMailTransportConfig(ro);
    expect(setRes.data).toMatchObject({
      ...ro,
      transportConfig: {
        ...ro.transportConfig,
        auth: {
          ...ro.transportConfig.auth,
          pass: '',
        },
      },
    });

    const commonEmailOptions = await mailSenderService.htmlEmailOptions(mockMailOptions());
    const mailOptions = {
      ...commonEmailOptions,
      transporterName: MailTransporterType.Notify,
      to: mockMailTo,
    };
    const sendRes = await mailSenderService.sendMail(mailOptions, {
      transporterName: MailTransporterType.Notify,
      type: MailType.NotifyMerge,
    });
    expect(sendRes).toBe(true);
  });

  it('should send notify merge mail', async () => {
    const ro: ISetSettingMailTransportConfigRo = {
      name: SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG,
      transportConfig: mockMailTransportConfig,
    };

    const setRes = await setSettingMailTransportConfig(ro);
    expect(setRes.data).toMatchObject({
      ...ro,
      transportConfig: {
        ...ro.transportConfig,
        auth: {
          ...ro.transportConfig.auth,
          pass: '',
        },
      },
    });

    const htmlEmailOptions = await mailSenderService.htmlEmailOptions(mockMailOptions());
    const mailOptions1 = {
      ...htmlEmailOptions,
      transporterName: MailTransporterType.Notify,
      to: mockMailTo,
    };
    const promises = [];
    const promise1 = mailSenderService.sendMail(mailOptions1, {
      transporterName: MailTransporterType.Notify,
      type: MailType.Notify,
    });
    promises.push(promise1);
    const commonEmailOptions = await mailSenderService.commonEmailOptions(mockMailOptions());
    const mailOptions2 = {
      ...commonEmailOptions,
      transporterName: MailTransporterType.Notify,
      to: mockMailTo,
    };
    const promise2 = mailSenderService.sendMail(mailOptions2, {
      transporterName: MailTransporterType.Notify,
      type: MailType.Notify,
    });
    promises.push(promise2);
    const emailVerifyCodeEmailOptions = await mailSenderService.sendEmailVerifyCodeEmailOptions({
      title: 'sendEmailVerifyCodeEmail',
      message: 'code: 123456',
    });
    const mailOptions3 = {
      ...emailVerifyCodeEmailOptions,
      transporterName: MailTransporterType.Notify,
      to: mockMailTo,
    };
    const promise3 = mailSenderService.sendMail(mailOptions3, {
      transporterName: MailTransporterType.Notify,
      type: MailType.Notify,
    });
    promises.push(promise3);

    await Promise.all(promises);

    await new Promise((resolve) => setTimeout(resolve, 1000 * 2));
  });
});
