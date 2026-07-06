import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ISendMailOptions as NestjsSendMailOptions } from '@nestjs-modules/mailer';
import type { IMailTransportConfig } from '@teable/openapi';
import { createTransport } from 'nodemailer';

export type ISendMailOptions = NestjsSendMailOptions & { senderName?: string };

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
  const transporter = createTransport(config);
  try {
    await transporter.verify();
  } catch (error) {
    throw new BadRequestException(
      `Invalid mail transporter: ${error instanceof Error ? error.message : 'Unknown error'}`
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
