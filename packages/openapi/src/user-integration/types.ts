import { z } from '../zod';

export enum UserIntegrationProvider {
  Slack = 'slack',
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

export const userIntegrationMetadataSchema = z.union([userIntegrationSlackMetadataSchema]);

export type IUserIntegrationMetadata = z.infer<typeof userIntegrationMetadataSchema>;
