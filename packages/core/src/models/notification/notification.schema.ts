import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { NotificationTypeEnum } from './notification.enum';

export const systemIconSchema = z.object({
  iconUrl: z.string(),
});
export type INotificationSystemIcon = z.infer<typeof systemIconSchema>;

export const collaboratorCellTagIconSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  userAvatarUrl: z.string(),
});
export type INotificationCollaboratorCellTagIcon = z.infer<typeof collaboratorCellTagIconSchema>;

export const notificationIconSchema = z.union([systemIconSchema, collaboratorCellTagIconSchema]);
export type INotificationIcon = z.infer<typeof notificationIconSchema>;

export const notificationSchema = z.object({
  id: z.string().startsWith(IdPrefix.Notification),
  notifyIcon: notificationIconSchema,
  notifyType: z.nativeEnum(NotificationTypeEnum),
  url: z.string(),
  message: z.string(),
  isRead: z.boolean(),
  createdTime: z.string(),
});
export type INotification = z.infer<typeof notificationSchema>;

export const notificationSocketVoSchema = z.object({
  notification: notificationSchema,
  unreadCount: z.number().nonnegative().int(),
});
export type INotificationSocketVo = z.infer<typeof notificationSocketVoSchema>;
