import type { ConfigService } from '@nestjs/config';
import type { ISendMailOptions as NestjsSendMailOptions } from '@nestjs-modules/mailer';
import { HttpErrorCode } from '@teable/core';
import type { IMailTransportConfig } from '@teable/openapi';
import { createTransport } from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { CustomHttpException } from '../../custom.exception';

// In-Reply-To is a Message-ID header: nodemailer only takes a string there, the mailer type also allows an Address
export type ISendMailOptions = Omit<NestjsSendMailOptions, 'inReplyTo'> &
  Pick<SendMailOptions, 'inReplyTo'> & { senderName?: string };

/** Truncate a user-provided name for a mail subject; maxLength <= 0 (or NaN) disables. */
export const truncateMailName = (value: string, maxLength: number): string => {
  if (!(maxLength > 0) || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
};

export const helpers = (config: ConfigService) => {
  const publicOrigin = config.get<string>('PUBLIC_ORIGIN');
  return {
    publicOrigin: function () {
      return publicOrigin;
    },
    currentYear: function () {
      return new Date().getFullYear();
    },
  };
};

export const verifyTransport = async (config: IMailTransportConfig) => {
  const transporter = createTransport(config); // NOSONAR typescript:S5332 -- SMTP transport security (STARTTLS/TLS) comes from the administrator-provided config
  try {
    await transporter.verify();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    throw new CustomHttpException(
      `Invalid mail transporter: ${detail}`,
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: { i18nKey: 'httpErrors.email.transporterInvalid', context: { detail } },
      }
    );
  }
  return true;
};

export const buildEmailFrom = (sender: string, senderName?: string) => {
  if (!senderName) {
    return sender;
  }
  return `${senderName} <${sender}>`;
};
