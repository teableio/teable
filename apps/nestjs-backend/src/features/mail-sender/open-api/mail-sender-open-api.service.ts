import { Injectable } from '@nestjs/common';
import type { ISendEmailRo, ISendEmailVo, ITestMailTransportConfigRo } from '@teable/openapi';
import { MailBodyType, MailTransporterType, MailType, toEmailArray } from '@teable/openapi';
import MarkdownIt from 'markdown-it';
import { createTransport } from 'nodemailer';
import { IMailConfig, MailConfig } from '../../../configs/mail.config';
import { type ISendMailOptions } from '../mail-helpers';
import { MailSenderService } from '../mail-sender.service';

// Raw HTML stays enabled on purpose: the API caller can already submit an `html` body, so markdown
// passthrough adds no capability, and the result only goes to the mail transport.
const markdownIt = MarkdownIt({ html: true, breaks: true }); // NOSONAR typescript:S5247 caller-controlled email body

type ISendEmailExtras = {
  footerHtml?: string;
  list?: ISendMailOptions['list'];
  headers?: ISendMailOptions['headers'];
};

@Injectable()
export class MailSenderOpenApiService {
  constructor(
    protected readonly mailSenderService: MailSenderService,
    @MailConfig() protected readonly mailConfig: IMailConfig
  ) {}

  async testTransportConfig(testMailTransportConfigRo: ITestMailTransportConfigRo): Promise<void> {
    const { transportConfig, to, message } = testMailTransportConfigRo;
    const transport = createTransport(transportConfig); // NOSONAR typescript:S5332 -- admin-only endpoint (instance|update); STARTTLS/TLS comes from the SMTP config the admin is testing
    await transport.verify();

    const option = await this.mailSenderService.sendTestEmailOptions({ message });
    await this.mailSenderService.sendMailByConfig({ to, ...option }, transportConfig);
  }

  async sendEmail(_baseId: string, ro: ISendEmailRo & ISendEmailExtras): Promise<ISendEmailVo> {
    const { subject, body, bodyType, replyTo, headers, smtp, footerHtml, list } = ro;

    const rendered = bodyType === MailBodyType.Markdown ? markdownIt.render(body) : body;
    const html = rendered + (footerHtml ?? '');

    const result = await this.mailSenderService.sendMail(
      {
        to: toEmailArray(ro.to),
        cc: toEmailArray(ro.cc),
        bcc: toEmailArray(ro.bcc),
        subject,
        html,
        headers,
        replyTo,
        list,
      },
      {
        shouldThrow: true,
        type: MailType.ApiSendEmailAction,
        transportConfig: smtp,
        transporterName: MailTransporterType.Automation,
      }
    );

    return {
      success: !!result,
      message: result ? 'Email sent successfully' : 'Failed to send email',
    };
  }
}
