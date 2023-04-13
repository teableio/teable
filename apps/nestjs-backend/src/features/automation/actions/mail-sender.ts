import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import _ from 'lodash';
import { createTransport } from 'nodemailer';
import { replaceVars } from 'src/utils';
import loadConfig from '../../../configs/config';
import { actionConst, ActionCore, ActionResponseStatus } from './action-core';

export interface IMailSenderRequest extends Record<string, unknown> {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string[];
  replyTo?: string[];
  message: string[];
}

export class MailSender extends ActionCore {
  constructor(id: string, mailSenderRequest?: IMailSenderRequest, priority?: number) {
    super(id, mailSenderRequest);

    this.setPriority(priority ? priority : 1);
  }

  public onSuccess = async (
    event: Event,
    almanac: Almanac,
    _ruleResult: RuleResult
  ): Promise<void> => {
    const mailConfig = loadConfig().mail;
    const transporter = createTransport({
      service: mailConfig.service,
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.secure,
      auth: {
        user: mailConfig.auth.user,
        pass: mailConfig.auth.pass,
      },
    });

    const { to, cc, bcc, subject, replyTo, message } = event.params as IMailSenderRequest;

    const mailOptions = {
      from: `"Teable" <${mailConfig.auth.user}>`,
      to: await replaceVars(to, almanac),
      cc: await replaceVars(cc, almanac),
      bcc: await replaceVars(bcc, almanac),
      subject: await replaceVars(subject, almanac),
      replyTo: await replaceVars(replyTo, almanac),
      html: await replaceVars(message, almanac),
    };

    const senderResult = await new Promise<boolean>((resolve) =>
      transporter.sendMail(mailOptions, async (error) => {
        if (error) {
          console.error('Mail sending failed, check your service.', error);
          resolve(false);
        }
        resolve(true);
      })
    );

    const outPut = { msg: 'ok', data: senderResult, code: ActionResponseStatus.Success };
    almanac.addRuntimeFact(`${this.name}${actionConst.OutPutFlag}`, outPut);
  };
}
