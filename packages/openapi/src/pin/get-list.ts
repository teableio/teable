import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { ViewType } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, serializeArrayAwareQuery } from '../utils';
import { z } from '../zod';
import { PinType } from './types';

export const GET_PIN_LIST = '/pin/list';

export const getPinListRoSchema = z.object({
  /**
   * Only return pins of these types. Omit it for the sidebar list: every navigable
   * resource type, but never chats. Chat pins (`PinType.Chat`) are only returned when
   * asked for explicitly, e.g. `?type=chat` for a "pinned chats" list across bases.
   */
  type: z.union([z.enum(PinType), z.array(z.enum(PinType))]).optional(),
});

export type IGetPinListRo = z.infer<typeof getPinListRoSchema>;

export const IGetPinListVoSchema = z.array(
  z.object({
    id: z.string(),
    type: z.enum(PinType),
    order: z.number(),
    name: z.string(),
    icon: z.string().optional(),
    parentBaseId: z.string().optional(),
    viewMeta: z
      .object({
        tableId: z.string(),
        type: z.enum(ViewType),
        pluginLogo: z.string().optional(),
      })
      .optional(),
    /** Present on `PinType.Chat` pins: where the chat lives and what it drives. */
    chatMeta: z
      .object({
        /** The chat's own type, e.g. `sandboxAgent` or `appGen` (`general` for legacy rows). */
        type: z.string(),
        /** Resource the chat belongs to, e.g. the app id of an `appGen` chat. */
        resourceId: z.string().optional(),
        lastModifiedTime: z.string().optional(),
        /** Activity state as on the chat history: idle / running / waiting_input / completed / failed. */
        state: z.string().optional(),
        /** Convenience: `state` is `completed` or `failed`. */
        unread: z.boolean().optional(),
      })
      .optional(),
  })
);

export type IGetPinListVo = z.infer<typeof IGetPinListVoSchema>;

export const GetPinRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PIN_LIST,
  description: 'Get  pin list',
  request: {
    query: getPinListRoSchema,
  },
  responses: {
    200: {
      description: 'Get  pin list, include base pin',
      content: {
        'application/json': {
          schema: IGetPinListVoSchema,
        },
      },
    },
  },
  tags: ['pin'],
});

export const getPinList = (query?: IGetPinListRo) => {
  // Arrays go out as repeated `type=…` pairs, the shape the server schema reads.
  return axios.get<IGetPinListVo>(GET_PIN_LIST, {
    params: query,
    paramsSerializer: serializeArrayAwareQuery,
  });
};
