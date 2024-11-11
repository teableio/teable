import { Injectable, Logger } from '@nestjs/common';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import { MailerService } from '@nestjs-modules/mailer';
import { CollaboratorType } from '@teable/openapi';
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

  async sendMail(
    mailOptions: ISendMailOptions,
    extra?: { shouldThrow?: boolean }
  ): Promise<boolean> {
    const sender = this.mailService.sendMail(mailOptions).then(() => true);
    if (extra?.shouldThrow) {
      return sender;
    }

    return sender.catch((reason) => {
      if (reason) {
        console.error(reason);
        this.logger.error(`Mail sending failed: ${reason.message}`, reason.stack);
      }
      return false;
    });
  }

  inviteEmailOptions(info: {
    name: string;
    email: string;
    resourceName: string;
    resourceType: CollaboratorType;
    inviteUrl: string;
  }) {
    const { name, email, inviteUrl, resourceName, resourceType } = info;
    const resourceAlias = resourceType === CollaboratorType.Space ? 'Space' : 'Base';
    return {
      subject: `${name} (${email}) invited you to their ${resourceAlias} ${resourceName} - ${this.baseConfig.brandName}`,
      template: 'normal',
      context: {
        name,
        email,
        resourceName,
        resourceAlias,
        inviteUrl,
        partialBody: 'invite',
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
    let subject, partialBody;
    const refLength = recordIds.length;

    const viewRecordUrlPrefix = `${this.mailConfig.origin}/base/${baseId}/${tableId}`;

    if (refLength <= 1) {
      subject = `${fromUserName} added you to the ${fieldName} field of a record in ${tableName}`;
      partialBody = 'collaborator-cell-tag';
    } else {
      subject = `${fromUserName} added you to ${refLength} records in ${tableName}`;
      partialBody = 'collaborator-multi-row-tag';
    }

    return {
      notifyMessage: subject,
      subject: `${subject} - ${this.baseConfig.brandName}`,
      template: 'normal',
      context: {
        notifyId,
        fromUserName,
        refLength,
        tableName,
        fieldName,
        recordIds,
        viewRecordUrlPrefix,
        partialBody,
      },
    };
  }

  commonEmailOptions(info: {
    to: string;
    title: string;
    message: string;
    buttonUrl: string;
    buttonText: string;
  }) {
    const { title, message } = info;

    return {
      notifyMessage: message,
      subject: `${title} - ${this.baseConfig.brandName}`,
      template: 'normal',
      context: {
        partialBody: 'common-body',
        ...info,
      },
    };
  }

  resetPasswordEmailOptions(info: { name: string; email: string; resetPasswordUrl: string }) {
    const { name, email, resetPasswordUrl } = info;
    return {
      subject: `Reset your password - ${this.baseConfig.brandName}`,
      template: 'normal',
      context: {
        name,
        email,
        resetPasswordUrl,
        partialBody: 'reset-password',
      },
    };
  }

  sendEmailVerifyCodeEmailOptions(info: { title: string; message: string }) {
    const { title } = info;
    return {
      subject: `${title} - ${this.baseConfig.brandName}`,
      template: 'normal',
      context: {
        partialBody: 'email-verify-code',
        ...info,
      },
    };
  }
}
