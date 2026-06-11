/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { HttpErrorCode } from '@teable/core';
import type { IMailTransportConfig } from '@teable/openapi';
import {
  MailType,
  CollaboratorType,
  SettingKey,
  MailTransporterType,
  EmailVerifyCodeType,
} from '@teable/openapi';
import { isString } from 'lodash';
import { I18nService } from 'nestjs-i18n';
import { createTransport } from 'nodemailer';
import { CacheService } from '../../cache/cache.service';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { CustomHttpException } from '../../custom.exception';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import type { I18nTranslations } from '../../types/i18n.generated';
import { SettingOpenApiService } from '../setting/open-api/setting-open-api.service';
import { buildEmailFrom, type ISendMailOptions } from './mail-helpers';

@Injectable()
export class MailSenderService {
  private logger = new Logger(MailSenderService.name);
  private readonly defaultTransportConfig: IMailTransportConfig;
  private readonly isMailConfigured: boolean;

  constructor(
    private readonly mailService: MailerService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cacheService: CacheService,
    private readonly i18n: I18nService<I18nTranslations>
  ) {
    const { host, port, secure, auth, sender, senderName, isConfigured } = this.mailConfig;
    this.isMailConfigured = isConfigured;
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

  /**
   * Log email content when mail is not configured.
   * This helps developers debug email sending without actually sending emails.
   */
  private logEmailContent(mailOptions: ISendMailOptions, from?: string): void {
    const emailInfo = {
      from: from ?? mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      template: mailOptions.template,
      context: mailOptions.context,
      body: mailOptions.html ?? mailOptions.text,
    };

    this.logger.log(
      `[Mail Not Configured] Would send email:\n${JSON.stringify(emailInfo, null, 2)}`
    );
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

  /**
   * Check if a transport config is valid (has required SMTP settings)
   */
  private isTransportConfigValid(config: IMailTransportConfig): boolean {
    return Boolean(config.host && config.auth?.user && config.auth?.pass);
  }

  async sendMailByConfig(mailOptions: ISendMailOptions, config: IMailTransportConfig) {
    // Check if the provided config is valid (could be from env vars or backend settings)
    if (!this.isTransportConfigValid(config)) {
      const from =
        mailOptions.from ??
        buildEmailFrom(config.sender, mailOptions.senderName ?? config.senderName);
      this.logEmailContent(mailOptions, from as string);
      return { messageId: 'mock-message-id-not-configured' };
    }

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

  async notifyMergeOptions(
    list: ISendMailOptions & { mailType: MailType }[],
    brandName: string,
    brandLogo: string
  ) {
    return {
      subject: this.i18n.t('common.email.templates.notify.subject', {
        args: { brandName },
      }),
      template: 'normal',
      context: {
        partialBody: 'notify-merge-body',
        brandName,
        brandLogo,
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
      // Explicit transport config provided - sendMailByConfig will validate it
      sender = this.sendMailByConfig(mailOptions, transportConfig).then(() => true);
    } else if (transporterName) {
      // Named transporter - may have config from backend settings, sendMailByTransporterName will validate
      sender = this.sendMailByTransporterName(mailOptions, transporterName, type).then(() => true);
    } else {
      // No custom config - use default mailer service
      // If env vars not configured, log the email instead
      if (!this.isMailConfigured) {
        const from =
          mailOptions.from ??
          buildEmailFrom(
            this.mailConfig.sender,
            mailOptions.senderName ?? this.mailConfig.senderName
          );
        this.logEmailContent(mailOptions, from as string);
        return true;
      }

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

  async inviteEmailOptions(info: {
    name: string;
    email: string;
    resourceName: string;
    resourceType: CollaboratorType;
    inviteUrl: string;
  }) {
    const { name, email, inviteUrl, resourceName, resourceType } = info;
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
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
        brandLogo,
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
      recordTitles: { id: string; title: string }[];
    };
  }) {
    const {
      notifyId,
      fromUserName,
      refRecord: { baseId, tableId, fieldName, tableName, recordIds, recordTitles },
    } = info;
    let subject, partialBody;
    const refLength = recordIds.length;

    const viewRecordUrlPrefix = `${this.mailConfig.origin}/base/${baseId}/table/${tableId}`;
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
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
        recordTitles: recordTitles.map((r) => {
          return {
            ...r,
            title: r.title || this.i18n.t('sdk.common.unnamedRecord'),
          };
        }),
        viewRecordUrlPrefix,
        partialBody,
        brandName,
        brandLogo,
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
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
    return {
      notifyMessage: message,
      subject: `${title} - ${brandName}`,
      template: 'normal',
      context: {
        partialBody: 'html-body',
        brandName,
        brandLogo,
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
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
    return {
      notifyMessage: message,
      subject: `${title} - ${brandName}`,
      template: 'normal',
      context: {
        partialBody: 'common-body',
        brandName,
        brandLogo,
        ...info,
      },
    };
  }

  async sendTestEmailOptions(info: { message?: string }) {
    const { message } = info;
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
    return {
      subject: this.i18n.t('common.email.templates.test.subject', {
        args: { brandName },
      }),
      template: 'normal',
      context: {
        partialBody: 'html-body',
        brandName,
        brandLogo,
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
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
    return {
      subject: this.i18n.t('common.email.templates.waitlistInvite.subject', {
        args: { name, email, brandName },
      }),
      template: 'normal',
      context: {
        ...info,
        partialBody: 'common-body',
        brandName,
        brandLogo,
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
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();

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
        brandLogo,
        title: this.i18n.t('common.email.templates.resetPassword.title'),
        message: this.i18n.t('common.email.templates.resetPassword.message'),
        buttonText: this.i18n.t('common.email.templates.resetPassword.buttonText'),
        buttonUrl: resetPasswordUrl,
      },
    };
  }

  async sendEmailVerifyCodeEmailOptions(
    payload:
      | {
          code: string;
          expiresIn: string;
          type: EmailVerifyCodeType.Signup | EmailVerifyCodeType.ChangeEmail;
        }
      | {
          domain: string;
          name: string;
          code: string;
          expiresIn: string;
          type: EmailVerifyCodeType.DomainVerification;
        }
  ) {
    const { type, code, expiresIn } = payload;
    if (this.baseConfig.enableEmailCodeConsole) {
      this.logger.log(`${type} Verification code: ${code} expiresIn ${expiresIn}`);
    }
    switch (type) {
      case EmailVerifyCodeType.Signup:
        return this.sendSignupVerificationEmailOptions(payload);
      case EmailVerifyCodeType.ChangeEmail:
        return this.sendChangeEmailCodeEmailOptions(payload);
      case EmailVerifyCodeType.DomainVerification:
        return this.sendDomainVerificationEmailOptions(payload);
    }
  }

  private async sendSignupVerificationEmailOptions(payload: { code: string; expiresIn: string }) {
    const { code, expiresIn } = payload;
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
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
        brandLogo,
        title: this.i18n.t('common.email.templates.emailVerifyCode.signupVerification.title'),
        message: this.i18n.t('common.email.templates.emailVerifyCode.signupVerification.message', {
          args: {
            code,
            expiresIn: parseInt(expiresIn),
          },
        }),
      },
    };
  }

  private async sendChangeEmailCodeEmailOptions(payload: { code: string; expiresIn: string }) {
    const { code, expiresIn } = payload;
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
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
        brandLogo,
        title: this.i18n.t('common.email.templates.emailVerifyCode.changeEmailVerification.title'),
        message: this.i18n.t(
          'common.email.templates.emailVerifyCode.changeEmailVerification.message',
          {
            args: {
              code,
              expiresIn: parseInt(expiresIn),
            },
          }
        ),
      },
    };
  }

  private async sendDomainVerificationEmailOptions(payload: {
    domain: string;
    name: string;
    code: string;
    expiresIn: string;
  }) {
    const { domain, name, code, expiresIn } = payload;
    const { brandName, brandLogo } = await this.settingOpenApiService.getServerBrand();
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
        brandLogo,
        title: this.i18n.t('common.email.templates.emailVerifyCode.domainVerification.title', {
          args: { domain, name },
        }),
        message: this.i18n.t('common.email.templates.emailVerifyCode.domainVerification.message', {
          args: {
            code,
            expiresIn: parseInt(expiresIn),
          },
        }),
      },
    };
  }
}
