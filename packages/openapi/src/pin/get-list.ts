import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { ViewType } from '@teable/core';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { PinType } from './types';

export const GET_PIN_LIST = '/pin/list';

export const IGetPinListVoSchema = z.array(
  z.object({
    id: z.string(),
    type: z.nativeEnum(PinType),
    order: z.number(),
    name: z.string(),
    icon: z.string().optional(),
    parentBaseId: z.string().optional(),
    viewMeta: z
      .object({
        tableId: z.string(),
        type: z.nativeEnum(ViewType),
        pluginLogo: z.string().optional(),
      })
      .optional(),
  })
);

export type IGetPinListVo = z.infer<typeof IGetPinListVoSchema>;

export const GetPinRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PIN_LIST,
  description: 'Get  pin list',
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

export const getPinList = () => {
  return axios.get<IGetPinListVo>(GET_PIN_LIST);
};
