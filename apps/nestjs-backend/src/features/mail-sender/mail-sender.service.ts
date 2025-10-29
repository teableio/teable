/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { HttpErrorCode } from '@teable/core';
import type { IMailTransportConfig } from '@teable/openapi';
import { MailType, CollaboratorType, SettingKey, MailTransporterType } from '@teable/openapi';
import { isString } from 'lodash';
import { I18nService } from 'nestjs-i18n';
import { createTransport } from 'nodemailer';
import { CacheService } from '../../cache/cache.service';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { CustomHttpException } from '../../custom.exception';
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
    private readonly eventEmitterService: EventEmitterService,
    private readonly cacheService: CacheService,
    private readonly i18n: I18nService
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

  async checkSendMailRateLimit<T>(
    options: { email: string; rateLimitKey: string; rateLimit: number },
    fn: () => Promise<T>
  ) {
    const { email, rateLimitKey: _rateLimitKey, rateLimit: _rateLimit } = options;
    // If rate limit is 0, skip rate limiting entirely
    if (_rateLimit <= 0) {
      return await fn();
    }
    const rateLimit = _rateLimit - 2; // 2 seconds for network latency
    const rateLimitKey = `send-mail-rate-limit:${_rateLimitKey}:${email}` as const;
    const existingRateLimit = await this.cacheService.get(rateLimitKey);
    if (existingRateLimit) {
      throw new CustomHttpException(
        `Reached the rate limit of sending mail, please try again after ${rateLimit} seconds`,
        HttpErrorCode.TOO_MANY_REQUESTS,
        {
          seconds: _rateLimit,
        }
      );
    }
    const result = await fn();
    await this.cacheService.setDetail(rateLimitKey, true, rateLimit);
    return result;
  }

  // https://nodemailer.com/smtp#connection-options
  async createTransporter(config: IMailTransportConfig) {
    const { connectionTimeout, greetingTimeout, dnsTimeout } = this.mailConfig;
    const transporter = createTransport({
      ...config,
      connectionTimeout,
      greetingTimeout,
      dnsTimeout,
    });
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
      subject: this.i18n.t('common.email.templates.notify.subject', {
        args: { brandName },
      }),
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
      subject: this.i18n.t('common.email.templates.invite.subject', {
        args: { name, email, resourceAlias, resourceName, brandName },
      }),
      template: 'normal',
      context: {
        name,
        email,
        resourceName,
        resourceAlias,
        inviteUrl,
        partialBody: 'invite',
        brandName,
        title: this.i18n.t('common.email.templates.invite.title'),
        message: this.i18n.t('common.email.templates.invite.message', {
          args: { name, email, resourceAlias, resourceName },
        }),
        buttonText: this.i18n.t('common.email.templates.invite.buttonText'),
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
      subject = this.i18n.t('common.email.templates.collaboratorCellTag.subject', {
        args: { fromUserName, fieldName, tableName },
      });
      partialBody = 'collaborator-cell-tag';
    } else {
      subject = this.i18n.t('common.email.templates.collaboratorMultiRowTag.subject', {
        args: { fromUserName, refLength, tableName },
      });
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
        title: this.i18n.t('common.email.templates.collaboratorCellTag.title', {
          args: { fromUserName, fieldName, tableName },
        }),
        buttonText: this.i18n.t('common.email.templates.collaboratorCellTag.buttonText'),
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

  async sendTestEmailOptions(info: { message?: string }) {
    const { message } = info;
    const { brandName } = await this.settingOpenApiService.getServerBrand();
    return {
      subject: this.i18n.t('common.email.templates.test.subject', {
        args: { brandName },
      }),
      template: 'normal',
      context: {
        partialBody: 'html-body',
        brandName,
        title: this.i18n.t('common.email.templates.test.title'),
        message: message || this.i18n.t('common.email.templates.test.message'),
      },
    };
  }

  async waitlistInviteEmailOptions(info: {
    code: string;
    times: number;
    name: string;
    email: string;
    waitlistInviteUrl: string;
  }) {
    const { code, times, name, email, waitlistInviteUrl } = info;
    const { brandName } = await this.settingOpenApiService.getServerBrand();
    return {
      subject: this.i18n.t('common.email.templates.waitlistInvite.subject', {
        args: { name, email, brandName },
      }),
      template: 'normal',
      context: {
        ...info,
        partialBody: 'common-body',
        brandName,
        title: this.i18n.t('common.email.templates.waitlistInvite.title'),
        message: this.i18n.t('common.email.templates.waitlistInvite.message', {
          args: { brandName, code, times },
        }),
        buttonText: this.i18n.t('common.email.templates.waitlistInvite.buttonText'),
        buttonUrl: waitlistInviteUrl,
      },
    };
  }

  async resetPasswordEmailOptions(info: { name: string; email: string; resetPasswordUrl: string }) {
    const { resetPasswordUrl } = info;
    const { brandName } = await this.settingOpenApiService.getServerBrand();

    return {
      subject: this.i18n.t('common.email.templates.resetPassword.subject', {
        args: {
          brandName,
        },
      }),
      template: 'normal',
      context: {
        partialBody: 'reset-password',
        brandName,
        title: this.i18n.t('common.email.templates.resetPassword.title'),
        message: this.i18n.t('common.email.templates.resetPassword.message'),
        buttonText: this.i18n.t('common.email.templates.resetPassword.buttonText'),
        buttonUrl: resetPasswordUrl,
      },
    };
  }

  async sendSignupVerificationEmailOptions(info: { code: string; expiresIn: string }) {
    const { code, expiresIn } = info;
    const { brandName } = await this.settingOpenApiService.getServerBrand();
    return {
      subject: this.i18n.t('common.email.templates.emailVerifyCode.signupVerification.subject', {
        args: {
          brandName,
        },
      }),
      template: 'normal',
      context: {
        partialBody: 'email-verify-code',
        brandName,
        title: this.i18n.t('common.email.templates.emailVerifyCode.signupVerification.title'),
        message: this.i18n.t('common.email.templates.emailVerifyCode.signupVerification.message', {
          args: {
            code,
            expiresIn,
          },
        }),
      },
    };
  }

  async sendDomainVerificationEmailOptions(info: {
    domain: string;
    name: string;
    code: string;
    expiresIn: string;
  }) {
    const { domain, name, code, expiresIn } = info;
    const { brandName } = await this.settingOpenApiService.getServerBrand();
    return {
      subject: this.i18n.t('common.email.templates.emailVerifyCode.domainVerification.subject', {
        args: {
          brandName,
        },
      }),
      template: 'normal',
      context: {
        partialBody: 'email-verify-code',
        brandName,
        title: this.i18n.t('common.email.templates.emailVerifyCode.domainVerification.title', {
          args: { domain, name },
        }),
        message: this.i18n.t('common.email.templates.emailVerifyCode.domainVerification.message', {
          args: {
            code,
            expiresIn,
          },
        }),
      },
    };
  }

  async sendChangeEmailCodeEmailOptions(info: { code: string; expiresIn: string }) {
    const { code, expiresIn } = info;
    const { brandName } = await this.settingOpenApiService.getServerBrand();
    return {
      subject: this.i18n.t(
        'common.email.templates.emailVerifyCode.changeEmailVerification.subject',
        {
          args: { brandName },
        }
      ),
      template: 'normal',
      context: {
        partialBody: 'email-verify-code',
        brandName,
        title: this.i18n.t('common.email.templates.emailVerifyCode.changeEmailVerification.title'),
        message: this.i18n.t(
          'common.email.templates.emailVerifyCode.changeEmailVerification.message',
          {
            args: { code, expiresIn },
          }
        ),
      },
    };
  }
}
