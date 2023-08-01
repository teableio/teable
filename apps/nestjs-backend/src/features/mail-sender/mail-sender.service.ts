import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Transporter, SendMailOptions } from 'nodemailer';
import { createTransport } from 'nodemailer';
import type { IMailConfig } from '../../configs/mail.config';

@Injectable()
export class MailSenderService {
  private logger = new Logger(MailSenderService.name);
  private transporter: Transporter;

  private mailConfig: IMailConfig;

  constructor(private configService: ConfigService) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.mailConfig = this.configService.get<IMailConfig>('mail')!;

    this.transporter = createTransport({
      service: this.mailConfig.service,
      host: this.mailConfig.host,
      port: this.mailConfig.port,
      secure: this.mailConfig.secure,
      auth: {
        user: this.mailConfig.auth.user,
        pass: this.mailConfig.auth.pass,
      },
    });
  }

  async sendMail(mailOptions: SendMailOptions): Promise<boolean> {
    mailOptions = {
      from: `"Teable" <${this.mailConfig.auth.user}>`,
      ...mailOptions,
    };

    return new Promise<boolean>((resolve) =>
      this.transporter.sendMail(mailOptions, async (error) => {
        if (error) {
          this.logger.error('Mail sending failed, check your service.', error);
          resolve(false);
        }
        resolve(true);
      })
    );
  }
}
