import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import type { IMailTransportConfig } from '@teable/openapi';
import { MailType, CollaboratorType, SettingKey, MailTransporterType } from '@teable/openapi';
import { createTransport } from 'nodemailer';
import { CacheService } from '../../cache/cache.service';
import type { ICacheStore } from '../../cache/types';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { SettingOpenApiService } from '../setting/open-api/setting-open-api.service';
import { buildEmailFrom } from './mail-helpers';

@Injectable()
export class MailSenderService {
  private readonly notifyMergeKey = 'mail-sender:notify-merge:list';
  private logger = new Logger(MailSenderService.name);
  private readonly defaultTransportConfig: IMailTransportConfig;

  constructor(
    private readonly mailService: MailerService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly cacheService: CacheService<ICacheStore>
  ) {
    const { host, port, secure, auth, sender, senderName } = this.mailConfig;
    this.defaultTransportConfig = {
      senderName,
      sender,
      host,
      port,
      secure,
      auth: {
        user: auth.user || '',
        pass: auth.pass || '',
      },
    };
  }

  async createTransporter(config: IMailTransportConfig) {
    const transporter = createTransport(config);
    const templateAdapter = this.mailService['templateAdapter'];
    this.mailService['initTemplateAdapter'](templateAdapter, transporter);
    return transporter;
  }

  async sendMailByConfig(mailOptions: ISendMailOptions, config: IMailTransportConfig) {
    const instance = await this.createTransporter(config);
    let from = mailOptions.from;
    if (!from) {
      from = buildEmailFrom(config.sender, config.senderName);
    }
    return instance.sendMail({ ...mailOptions, from });
  }

  async getTransportConfigByName(name?: MailTransporterType) {
    const setting = await this.settingOpenApiService.getSetting([
      SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG,
      SettingKey.AUTOMATION_MAIL_TRANSPORT_CONFIG,
    ]);
    const defaultConfig = this.defaultTransportConfig;
    const notifyConfig = setting[SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG];
    const automationConfig = setting[SettingKey.AUTOMATION_MAIL_TRANSPORT_CONFIG];

    const notifyTransport = notifyConfig || defaultConfig;
    const automationTransport = automationConfig || notifyTransport || defaultConfig;

    let config = defaultConfig;
    if (name === MailTransporterType.Automation) {
      config = automationTransport;
    } else if (name === MailTransporterType.Notify) {
      config = notifyTransport;
    }

    return config;
  }

  async addToNotifyMerge(mailOptions: ISendMailOptions & { mailType: MailType }) {
    const { to } = mailOptions;
    if (!to || typeof to !== 'string') {
      return;
    }
    const obj = (await this.cacheService.get(this.notifyMergeKey)) || {};
    obj[to] = [...(obj[to] || []), mailOptions];
    await this.cacheService.set(this.notifyMergeKey, obj);
  }

  async notifyMergeOptions(list: (ISendMailOptions & { mailType: MailType })[], brandName: string) {
    return {
      subject: `Notify - ${brandName}`,
      template: 'normal',
      context: {
        partialBody: 'notify-merge-body',
        brandName,
        list: list.map((item) => ({
          ...item,
          mailType: item.mailType,
        })),
      },
    };
  }

  async sendMailFromCache() {
    const obj = await this.cacheService.get(this.notifyMergeKey);
    await this.cacheService.del(this.notifyMergeKey);
    if (!obj || Object.keys(obj).length === 0) {
      return;
    }

    const { brandName } = await this.settingOpenApiService.getServerBrand();
    for (const to in obj) {
      const list = obj[to];
      if (list.length === 0) {
        continue;
      }

      const mailOptions = await this.notifyMergeOptions(list, brandName);
      this.sendMailByTransporterName(
        {
          to,
          ...mailOptions,
        },
        MailTransporterType.Notify,
        MailType.NotifyMerge
      );
    }
  }

  async sendMailByTransporterName(
    mailOptions: ISendMailOptions,
    transporterName?: MailTransporterType,
    type?: MailType
  ) {
    if (transporterName === MailTransporterType.Notify && type === MailType.Notify) {
      await this.addToNotifyMerge({ ...mailOptions, mailType: type });
      return true;
    }
    const config = await this.getTransportConfigByName(transporterName);
    return await this.sendMailByConfig(mailOptions, config);
  }

  async sendMail(
    mailOptions: ISendMailOptions & { senderName?: string },
    extra?: {
      shouldThrow?: boolean;
      type?: MailType;
      transportConfig?: IMailTransportConfig;
      transporterName?: MailTransporterType;
    }
  ): Promise<boolean> {
    const { type, transportConfig, transporterName } = extra || {};
    let sender: Promise<boolean>;
    if (transportConfig) {
      sender = this.sendMailByConfig(mailOptions, transportConfig).then(() => true);
    } else if (transporterName) {
      sender = this.sendMailByTransporterName(mailOptions, transporterName, type).then(() => true);
    } else {
      let from = mailOptions.from;
      if (!from && mailOptions.senderName) {
        from = buildEmailFrom(this.mailConfig.sender, mailOptions.senderName);
      }
      sender = this.mailService.sendMail({ ...mailOptions, from }).then(() => true);
    }

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
    const { brandName } = await this.settingOpenApiService.getServerBrand();
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
    const { brandName } = await this.settingOpenApiService.getServerBrand();
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
    const { brandName } = await this.settingOpenApiService.getServerBrand();
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
    const { brandName } = await this.settingOpenApiService.getServerBrand();
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
    const { brandName } = await this.settingOpenApiService.getServerBrand();
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
