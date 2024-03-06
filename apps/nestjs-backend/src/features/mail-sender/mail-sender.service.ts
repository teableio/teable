import { Injectable, Logger } from '@nestjs/common';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import { MailerService } from '@nestjs-modules/mailer';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { IMailConfig, MailConfig } from '../../configs/mail.config';

@Injectable()
export class MailSenderService {
  private logger = new Logger(MailSenderService.name);

  constructor(
    private readonly mailService: MailerService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

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

  inviteEmailOptions(info: { name: string; email: string; spaceName: string; inviteUrl: string }) {
    const { name, email, inviteUrl, spaceName } = info;
    return {
      subject: `${name} (${email}) invited you to their space ${spaceName} - ${this.baseConfig.brandName}`,
      template: 'invite',
      context: {
        name,
        email,
        spaceName,
        inviteUrl,
      },
    };
  }

  collaboratorCellTagEmailOptions(info: {
    notifyId: string;
    fromUserName: string;
    refRecord: {
      baseId: string;
      tableId: string;
      tableName: string;
      fieldName: string;
      recordIds: string[];
    };
  }) {
    const {
      notifyId,
      fromUserName,
      refRecord: { baseId, tableId, fieldName, tableName, recordIds },
    } = info;
    let subject, template;
    const refLength = recordIds.length;

    const viewRecordUrlPrefix = `${this.mailConfig.origin}/base/${baseId}/${tableId}`;

    if (refLength <= 1) {
      subject = `${fromUserName} added you to the ${fieldName} field of a record in ${tableName}`;
      template = 'collaborator-cell-tag';
    } else {
      subject = `${fromUserName} added you to ${refLength} records in ${tableName}`;
      template = 'collaborator-multi-row-tag';
    }

    return {
      notifyMessage: subject,
      subject: `${subject} - ${this.baseConfig.brandName}`,
      template,
      context: {
        notifyId,
        fromUserName,
        refLength,
        tableName,
        fieldName,
        recordIds,
        viewRecordUrlPrefix,
      },
    };
  }
}
