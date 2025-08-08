/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const mailConfig = registerAs('mail', () => ({
  origin: process.env.PUBLIC_ORIGIN ?? 'https://teable.ai',
  host: process.env.BACKEND_MAIL_HOST ?? 'smtp.teable.ai',
  port: parseInt(process.env.BACKEND_MAIL_PORT ?? '465', 10),
  secure: Object.is(process.env.BACKEND_MAIL_SECURE ?? 'true', 'true'),
  sender: process.env.BACKEND_MAIL_SENDER ?? 'noreply.teable.ai',
  senderName: process.env.BACKEND_MAIL_SENDER_NAME ?? 'Teable',
  auth: {
    user: process.env.BACKEND_MAIL_AUTH_USER,
    pass: process.env.BACKEND_MAIL_AUTH_PASS,
  },
}));

export const MailConfig = () => Inject(mailConfig.KEY);

export type IMailConfig = ConfigType<typeof mailConfig>;
