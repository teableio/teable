import { Injectable, Logger } from '@nestjs/common';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailSenderService {
  private logger = new Logger(MailSenderService.name);

  constructor(private readonly mailService: MailerService) {}

  async sendMail(mailOptions: ISendMailOptions): Promise<boolean> {
    return this.mailService
      .sendMail(mailOptions)
      .then(() => true)
      .catch((reason) => {
        if (reason) {
          this.logger.error(`Mail sending failed: ${reason.message}`, reason.stack);
        }
        return false;
      });
  }
}
