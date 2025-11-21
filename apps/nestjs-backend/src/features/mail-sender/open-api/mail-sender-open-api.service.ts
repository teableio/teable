import { Injectable } from '@nestjs/common';
import type { ITestMailTransportConfigRo } from '@teable/openapi';
import { createTransport } from 'nodemailer';
import { IMailConfig, MailConfig } from '../../../configs/mail.config';
import { MailSenderService } from '../mail-sender.service';

@Injectable()
export class MailSenderOpenApiService {
  constructor(
    private readonly mailSenderService: MailSenderService,
    @MailConfig() private readonly mailConfig: IMailConfig
  ) {}

  async testTransportConfig(testMailTransportConfigRo: ITestMailTransportConfigRo): Promise<void> {
    const { transportConfig, to, message } = testMailTransportConfigRo;
    const transport = createTransport(transportConfig);
    await transport.verify();

    const option = await this.mailSenderService.sendTestEmailOptions({ message });
    await this.mailSenderService.sendMailByConfig({ to, ...option }, transportConfig);
  }
}
