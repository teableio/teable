import { z } from 'zod';

export enum MailTransporterType {
  DEFAULT = 'default',
  TEST = 'test',
  NOTIFY = 'notify',
  AUTOMATION = 'automation',
}

export enum MailType {
  VERIFY_CODE = 'verifyCode',
  RESET_PASSWORD = 'resetPassword',
  INVITE = 'invite',
  NOTIFY = 'notify',
  AUTOMATION = 'automation',
}

export const mailTransportConfigSchema = z.object({
  senderName: z.string().optional(),
  sender: z.string(),
  host: z.string(),
  port: z.number(),
  secure: z.boolean().optional(),
  auth: z.object({
    user: z.string(),
    pass: z.string(),
  }),
});
export type IMailTransportConfig = z.infer<typeof mailTransportConfigSchema>;
