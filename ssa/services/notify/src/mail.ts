import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { IEnv } from './config.js';
import type { ILogger } from './logger.js';

export interface IOutgoingMail {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface IMailer {
  isConfigured(): boolean;
  send(mail: IOutgoingMail): Promise<void>;
}

export const createMailer = (env: IEnv, logger: ILogger): IMailer => {
  const configured = Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
  let transporter: Transporter | undefined;

  if (configured) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    });
  }

  return {
    isConfigured: () => configured,
    async send(mail: IOutgoingMail): Promise<void> {
      if (mail.to.length === 0) {
        logger.warn('mail skipped: no recipients', { subject: mail.subject });
        return;
      }
      if (env.SSA_DRY_RUN || !transporter) {
        logger.info(`[dry-run] email would be sent`, {
          to: mail.to,
          subject: mail.subject,
          reason: env.SSA_DRY_RUN ? 'SSA_DRY_RUN=true' : 'mail not configured',
        });
        return;
      }
      await transporter.sendMail({
        from: `"${env.GMAIL_SENDER_NAME}" <${env.GMAIL_USER}>`,
        to: mail.to.join(', '),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      logger.info('email sent', { to: mail.to, subject: mail.subject });
    },
  };
};
