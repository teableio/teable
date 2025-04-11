import { Injectable, Logger } from '@nestjs/common';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import { MailerService } from '@nestjs-modules/mailer';
import { CollaboratorType } from '@teable/openapi';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { SettingService } from '../setting/setting.service';

@Injectable()
export class MailSenderService {
  private logger = new Logger(MailSenderService.name);

  constructor(
    private readonly mailService: MailerService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    private readonly settingService: SettingService
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
    brandName: string;
    email: string;
    resourceName: string;
    resourceType: CollaboratorType;
    inviteUrl: string;
  }) {
    const { name, email, inviteUrl, resourceName, resourceType, brandName } = info;
    const resourceAlias = resourceType === CollaboratorType.Space ? 'Space' : 'Base';

    return {
      subject: `${name} (${email}) invited you to their ${resourceAlias} ${resourceName} - ${brandName}`,
      template: 'normal',
      context: {
        name,
        email,
        resourceName,
        resourceAlias,
        inviteUrl,
        partialBody: 'invite',
        brandName,
      },
    };
  }

  async collaboratorCellTagEmailOptions(info: {
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
    const { brandName } = await this.settingService.getServerBrand();
    if (refLength <= 1) {
      subject = `${fromUserName} added you to the ${fieldName} field of a record in ${tableName}`;
      partialBody = 'collaborator-cell-tag';
    } else {
      subject = `${fromUserName} added you to ${refLength} records in ${tableName}`;
      partialBody = 'collaborator-multi-row-tag';
    }

    return {
      notifyMessage: subject,
      subject: `${subject} - ${brandName}`,
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
        brandName,
      },
    };
  }

  async htmlEmailOptions(info: {
    to: string;
    title: string;
    message: string;
    buttonUrl: string;
    buttonText: string;
  }) {
    const { title, message } = info;
    const { brandName } = await this.settingService.getServerBrand();
    return {
      notifyMessage: message,
      subject: `${title} - ${brandName}`,
      template: 'normal',
      context: {
        partialBody: 'html-body',
        brandName,
        ...info,
      },
    };
  }

  async commonEmailOptions(info: {
    to: string;
    title: string;
    message: string;
    buttonUrl: string;
    buttonText: string;
  }) {
    const { title, message } = info;
    const { brandName } = await this.settingService.getServerBrand();
    return {
      notifyMessage: message,
      subject: `${title} - ${brandName}`,
      template: 'normal',
      context: {
        partialBody: 'common-body',
        brandName,
        ...info,
      },
    };
  }

  async resetPasswordEmailOptions(info: { name: string; email: string; resetPasswordUrl: string }) {
    const { name, email, resetPasswordUrl } = info;
    const { brandName } = await this.settingService.getServerBrand();
    return {
      subject: `Reset your password - ${brandName}`,
      template: 'normal',
      context: {
        name,
        email,
        resetPasswordUrl,
        brandName,
        partialBody: 'reset-password',
      },
    };
  }

  async sendEmailVerifyCodeEmailOptions(info: { title: string; message: string }) {
    const { title } = info;
    const { brandName } = await this.settingService.getServerBrand();
    return {
      subject: `${title} - ${brandName}`,
      template: 'normal',
      context: {
        partialBody: 'email-verify-code',
        brandName,
        ...info,
      },
    };
  }
}
