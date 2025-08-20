import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import type { IMailTransportConfig } from '@teable/openapi';
import { MailType, CollaboratorType, SettingKey, MailTransporterType } from '@teable/openapi';
import { isString } from 'lodash';
import { createTransport } from 'nodemailer';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { SettingOpenApiService } from '../setting/open-api/setting-open-api.service';
import { buildEmailFrom, type ISendMailOptions } from './mail-helpers';

@Injectable()
export class MailSenderService {
  private logger = new Logger(MailSenderService.name);
  private readonly defaultTransportConfig: IMailTransportConfig;

  constructor(
    private readonly mailService: MailerService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly eventEmitterService: EventEmitterService
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
    const from =
      mailOptions.from ??
      buildEmailFrom(config.sender, mailOptions.senderName ?? config.senderName);
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

  async notifyMergeOptions(list: ISendMailOptions & { mailType: MailType }[], brandName: string) {
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

  async sendMailByTransporterName(
    mailOptions: ISendMailOptions,
    transporterName?: MailTransporterType,
    type?: MailType
  ) {
    const mergeNotifyType = [MailType.System, MailType.Notify, MailType.Common];
    const checkNotify =
      type && transporterName === MailTransporterType.Notify && mergeNotifyType.includes(type);
    const checkTo = mailOptions.to && isString(mailOptions.to);
    if (checkNotify && checkTo) {
      this.eventEmitterService.emit(Events.NOTIFY_MAIL_MERGE, {
        payload: { ...mailOptions, mailType: type },
      });
      return true;
    }
    const config = await this.getTransportConfigByName(transporterName);
    return await this.sendMailByConfig(mailOptions, config);
  }

  async sendMail(
    mailOptions: ISendMailOptions,
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
      const from =
        mailOptions.from ??
        buildEmailFrom(
          this.mailConfig.sender,
          mailOptions.senderName ?? this.mailConfig.senderName
        );

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
