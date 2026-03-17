import { z } from '../zod';

export enum UserIntegrationProvider {
  Slack = 'slack',
  Gmail = 'gmail',
  Outlook = 'outlook',
  // Future: Discord = 'discord',
  // Future: Telegram = 'telegram',
  // Future: Teams = 'teams',
}

export const userIntegrationSlackMetadataSchema = z.object({
  userInfo: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  teamInfo: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export type IUserIntegrationSlackMetadata = z.infer<typeof userIntegrationSlackMetadataSchema>;

export const userIntegrationEmailMetadataSchema = z.object({
  userInfo: z.object({
    email: z.string(),
    name: z.string(),
  }),
});

export type IUserIntegrationEmailMetadata = z.infer<typeof userIntegrationEmailMetadataSchema>;

export const userIntegrationGmailMetadataSchema = userIntegrationEmailMetadataSchema;

export type IUserIntegrationGmailMetadata = IUserIntegrationEmailMetadata;

export const userIntegrationOutlookMetadataSchema = userIntegrationEmailMetadataSchema;

export type IUserIntegrationOutlookMetadata = IUserIntegrationEmailMetadata;

export const userIntegrationMetadataSchema = z.union([
  userIntegrationSlackMetadataSchema,
  userIntegrationGmailMetadataSchema,
  userIntegrationOutlookMetadataSchema,
]);

export type IUserIntegrationMetadata = z.infer<typeof userIntegrationMetadataSchema>;
