import type { INestApplication } from '@nestjs/common';
import type { ISetSettingMailTransportConfigRo, ITestMailTransportConfigRo } from '@teable/openapi';
import {
  MailTransporterType,
  setSettingMailTransportConfig,
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
    const mailSenderService = app.get(MailSenderService);

    const commonEmailOptions = await mailSenderService.htmlEmailOptions(mockMailOptions());
    const mailOptions = {
      transporterName: MailTransporterType.NOTIFY,
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
      name: 'notifyMailTransportConfig',
      transportConfig: mockMailTransportConfig,
    };

    const setRes = await setSettingMailTransportConfig(ro);
    expect(setRes).toMatchObject(ro);

    const commonEmailOptions = await mailSenderService.htmlEmailOptions(mockMailOptions());
    const mailOptions = {
      transporterName: MailTransporterType.NOTIFY,
      to: mockMailTo,
      ...commonEmailOptions,
    };
    const sendRes = await mailSenderService.sendMail(mailOptions);
    expect(sendRes).toBe(true);
  });
});
