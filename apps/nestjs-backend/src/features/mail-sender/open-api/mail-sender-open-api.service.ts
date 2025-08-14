import { InjectQueue } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ITestMailTransportConfigRo } from '@teable/openapi';
import { Queue } from 'bullmq';
import { createTransport } from 'nodemailer';
import { IMailConfig, MailConfig } from '../../../configs/mail.config';
import { MAIL_SENDER_QUEUE } from '../mail-sender.processor';
import { MailSenderService } from '../mail-sender.service';

@Injectable()
export class MailSenderOpenApiService implements OnModuleInit {
  private logger = new Logger(MailSenderOpenApiService.name);
  constructor(
    private readonly mailSenderService: MailSenderService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    @InjectQueue(MAIL_SENDER_QUEUE) private readonly mailSenderQueue: Queue
  ) {}

  async onModuleInit() {
    await this.mailSenderQueue.add(
      'sendNotifyMergeMail',
      {},
      {
        repeat: {
          every: 1000 * 60,
          immediately: true,
        },
      }
    );
    this.logger.log('[sendNotifyMergeMail job init] success every 1min immediately');
  }

  async testTransportConfig(testMailTransportConfigRo: ITestMailTransportConfigRo): Promise<void> {
    const { transportConfig, to, message } = testMailTransportConfigRo;
    const transport = createTransport(transportConfig);
    await transport.verify();

    const option = await this.mailSenderService.htmlEmailOptions({
      to,
      title: 'Test',
      message: message || 'This is a test email from Teable',
      buttonUrl: this.mailConfig.origin,
      buttonText: 'Teable',
    });
    await this.mailSenderService.sendMailByConfig({ to, ...option }, transportConfig);
  }
}
