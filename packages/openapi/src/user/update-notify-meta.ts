import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_NOTIFY_META = '/user/notify-meta';

/** The Web shell a user works in: chat-first (default) or the classic project/table layout. */
export const SPACE_LAYOUTS = ['chat', 'classic'] as const;
export const spaceLayoutSchema = z.enum(SPACE_LAYOUTS);
export type ISpaceLayout = z.infer<typeof spaceLayoutSchema>;

export const userNotifyMetaSchema = z.object({
  email: z.boolean().optional(),
  appBuilderChatIntroDismissed: z.boolean().optional(),
  /**
   * The two mobile push switches. Absent means on: someone who granted the system
   * permission has already said they want these, and an untouched setting is not a refusal.
   */
  pushGate: z.boolean().optional(),
  pushResult: z.boolean().optional(),
  /** Absent means the chat-first space shell; `classic` opts back into the previous layout. */
  spaceLayout: spaceLayoutSchema.optional(),
  /** Client ids of the OAuth apps whose notifications the user turned off. */
  mutedApps: z.array(z.string()).optional(),
});

export type IUserNotifyMeta = z.infer<typeof userNotifyMetaSchema>;

export const UpdateUserNotifyMetaRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_USER_NOTIFY_META,
  description: 'Update user notification meta',
  request: {
    body: {
      content: {
        'application/json': {
          schema: userNotifyMetaSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['user'],
});

export const updateUserNotifyMeta = async (updateUserNotifyMetaRo: IUserNotifyMeta) => {
  return axios.patch<void>(urlBuilder(UPDATE_USER_NOTIFY_META), updateUserNotifyMetaRo);
};
