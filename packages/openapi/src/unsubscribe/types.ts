import { MailType } from '../mail';
import { z } from '../zod';

export enum UnsubscribeSourceType {
  Empty = 'empty',
  Legacy = 'legacy',
  EmailLink = 'emailLink',
  Import = 'import',
}

// Storage schema - used when storing unsubscribe data
export const unsubscribeAutomationSendEmailSchema = z.object({
  type: z.literal(MailType.AutomationSendEmailAction),
  actionId: z.string(),
});

export type IUnsubscribeAutomationSendEmail = z.infer<typeof unsubscribeAutomationSendEmailSchema>;

export const unsubscribeApiSendEmailSchema = z.object({
  type: z.literal(MailType.ApiSendEmailAction),
});

export type IUnsubscribeApiSendEmail = z.infer<typeof unsubscribeApiSendEmailSchema>;

// Response schema - used when returning unsubscribe data in API responses
export const unsubscribeAutomationSendEmailMetaDataVoSchema = z.object({
  type: z.literal(MailType.AutomationSendEmailAction),
  workflow: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  action: z.object({
    id: z.string(),
    type: z.string(),
    category: z.string(),
  }),
});

export const unsubscribeApiSendEmailMetaDataVoSchema = z.object({
  type: z.literal(MailType.ApiSendEmailAction),
});

// emailLink covers both automation- and API-sent emails; `type` discriminates them.
export const unsubscribeEmailLinkMetaDataVoSchema = z.discriminatedUnion('type', [
  unsubscribeAutomationSendEmailMetaDataVoSchema,
  unsubscribeApiSendEmailMetaDataVoSchema,
]);

export type IUnsubscribeEmailLinkMetaDataVo = z.infer<typeof unsubscribeEmailLinkMetaDataVoSchema>;

// Storage metadata types (for database operations)
export type UnsubscribeSourceMetaDataMap = {
  [UnsubscribeSourceType.EmailLink]:
    | IUnsubscribeAutomationSendEmail
    | IUnsubscribeApiSendEmail
    | null;
  [UnsubscribeSourceType.Import]: null;
  [UnsubscribeSourceType.Empty]: null;
  [UnsubscribeSourceType.Legacy]: null;
};

// Response metadata types (for API responses)
export type UnsubscribeSourceMetaDataVoMap = {
  [UnsubscribeSourceType.EmailLink]: IUnsubscribeEmailLinkMetaDataVo;
  [UnsubscribeSourceType.Import]: null;
  [UnsubscribeSourceType.Empty]: null;
  [UnsubscribeSourceType.Legacy]: null;
};
