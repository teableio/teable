import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { NotificationTypeEnum } from './notification.enum';

export const systemIconSchema = z.object({
  iconUrl: z.string(),
});
export type INotificationSystemIcon = z.infer<typeof systemIconSchema>;

export const userIconSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  userAvatarUrl: z.string().nullable().optional(),
});
export type INotificationUserIcon = z.infer<typeof userIconSchema>;

export const notificationIconSchema = z.union([systemIconSchema, userIconSchema]);
export type INotificationIcon = z.infer<typeof notificationIconSchema>;

export const tableRecordUrlSchema = z.object({
  baseId: z.string().startsWith(IdPrefix.Base),
  tableId: z.string().startsWith(IdPrefix.Table),
  recordId: z.string().startsWith(IdPrefix.Record).optional(),
  commentId: z.string().startsWith(IdPrefix.Comment).optional(),
  downloadUrl: z.string().optional(),
});

export const notificationUrlSchema = tableRecordUrlSchema.optional();
export type INotificationUrl = z.infer<typeof notificationUrlSchema>;

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

export const notificationBufferSchema = z.object({
  notification: notificationSchema,
  unreadCount: z.number().nonnegative().int(),
});
export type INotificationBuffer = z.infer<typeof notificationBufferSchema>;
