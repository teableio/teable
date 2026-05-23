import { NotificationSeverityEnum } from '@teable/core';
import { axios } from '../axios';
import { z } from '../zod';

export const ADMIN_SEND_NOTIFICATION = '/admin/notification';

export const adminSendNotificationRoSchema = z.object({
  message: z.string().min(1).max(5000),
  severity: z.enum(NotificationSeverityEnum).optional().default(NotificationSeverityEnum.Info),
  userIds: z.array(z.string()).max(500).optional(),
  emails: z.array(z.string().email()).max(500).optional(),
});

export type IAdminSendNotificationRo = z.infer<typeof adminSendNotificationRoSchema>;

export const adminSendNotificationVoSchema = z.object({
  sentCount: z.number(),
  invalidEmails: z.array(z.string()).optional(),
  invalidUserIds: z.array(z.string()).optional(),
});

export type IAdminSendNotificationVo = z.infer<typeof adminSendNotificationVoSchema>;

export const sendAdminNotification = async (ro: IAdminSendNotificationRo) => {
  return axios.post<IAdminSendNotificationVo>(ADMIN_SEND_NOTIFICATION, ro);
};
