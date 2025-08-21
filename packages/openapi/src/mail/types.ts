import { z } from 'zod';

export enum MailTransporterType {
  Default = 'default',
  Test = 'test',
  Notify = 'notify',
  Automation = 'automation',
}

export enum MailType {
  Automation = 'automation',
  Notify = 'notify',
  System = 'system',
  VerifyCode = 'verifyCode',
  ResetPassword = 'resetPassword',
  Invite = 'invite',
  Common = 'common',
  ExportBase = 'exportBase',
  CollaboratorCellTag = 'collaboratorCellTag',
  CollaboratorMultiRowTag = 'collaboratorMultiRowTag',
  NotifyMerge = 'notifyMerge',
  WaitlistInvite = 'waitlistInvite',
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
