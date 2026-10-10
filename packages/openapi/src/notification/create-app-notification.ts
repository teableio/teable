import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CREATE_APP_NOTIFICATION = '/notifications';

export const APP_NOTIFICATION_TEXT_MAX_LENGTH = 500;
export const APP_NOTIFICATION_URL_MAX_LENGTH = 2048;

export const createAppNotificationRoSchema = z.object({
  externalId: z
    .string()
    .regex(/^[\w.:-]{1,128}$/)
    .openapi({
      description:
        "The app's own id for the notification, 1-128 of A-Z a-z 0-9 _ . : -. Sending the same id to the same user again changes nothing.",
    }),
  text: z.string().trim().min(1).max(APP_NOTIFICATION_TEXT_MAX_LENGTH).openapi({
    description:
      'Plain text in the language the app knows the user by; Teable does not translate it. Markup shows as typed.',
  }),
  url: z.string().max(APP_NOTIFICATION_URL_MAX_LENGTH).url().optional().openapi({
    description:
      "Where the notification leads: https, on the host of the app's homepage or of one of its redirect URIs.",
  }),
});

export type ICreateAppNotificationRo = z.infer<typeof createAppNotificationRoSchema>;

export const createAppNotificationVoSchema = z.object({
  status: z.enum(['created', 'duplicate', 'muted']).openapi({
    description:
      'created: the user got it. duplicate: this externalId already reached the user. muted: the user turned off notifications from this app, so it was dropped.',
  }),
});

export type ICreateAppNotificationVo = z.infer<typeof createAppNotificationVoSchema>;

export const CreateAppNotificationRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_APP_NOTIFICATION,
  description:
    "Send a notification to the user an OAuth app's access token belongs to. OAuth app tokens only, with the user|notifications_send scope. Limited to 30 a minute per app and user and 600 a minute per app; a 429 carries Retry-After.",
  request: {
    body: {
      content: {
        'application/json': {
          schema: createAppNotificationRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Accepted',
      content: {
        'application/json': {
          schema: createAppNotificationVoSchema,
        },
      },
    },
  },
  tags: ['notification'],
});

export const createAppNotification = async (ro: ICreateAppNotificationRo) => {
  return axios.post<ICreateAppNotificationVo>(CREATE_APP_NOTIFICATION, ro);
};
