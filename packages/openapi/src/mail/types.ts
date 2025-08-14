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
  System = 'system', // htmlEmailOptions
  VerifyCode = 'verifyCode', // sendEmailVerifyCodeEmailOptions
  ResetPassword = 'resetPassword', // resetPasswordEmailOptions
  Invite = 'invite', // inviteEmailOptions
  Common = 'common', // commonEmailOptions
  ExportBase = 'exportBase', // htmlEmailOptions
  CollaboratorCellTag = 'collaboratorCellTag', // collaboratorCellTagEmailOptions
  CollaboratorMultiRowTag = 'collaboratorMultiRowTag', // collaboratorCellTagEmailOptions
  NotifyMerge = 'notifyMerge', // notifyMergeOptions
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
