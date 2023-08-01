/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const mailConfig = registerAs('mail', () => ({
  service: process.env.BACKEND_MAIL_SERVICE || 'smtp.163.com',
  host: process.env.BACKEND_MAIL_HOST || 'smtp.163.com',
  port: parseInt(process.env.BACKEND_MAIL_PORT || '465', 10),
  secure: Object.is(process.env.BACKEND_MAIL_SECURE || 'true', 'true'),
  auth: {
    user: process.env.BACKEND_MAIL_AUTH_USER,
    pass: process.env.BACKEND_MAIL_AUTH_PASS,
  },
}));

export const MailConfig = () => Inject(mailConfig.KEY);

export type IMailConfig = ConfigType<typeof mailConfig>;
