import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { PinType } from './types';

export const UPDATE_PIN_ORDER = '/pin/order';

export const updatePinOrderRoSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(PinType),
  anchorId: z.string(),
  anchorType: z.nativeEnum(PinType),
  position: z.enum(['before', 'after']),
});

export type UpdatePinOrderRo = z.infer<typeof updatePinOrderRoSchema>;

export const UpdatePinOrderRoute: RouteConfig = registerRoute({
  method: 'put',
  path: UPDATE_PIN_ORDER,
  description: 'Update  pin order',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updatePinOrderRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Update  pin order successfully',
    },
  },
  tags: ['pin'],
});

export const updatePinOrder = (data: UpdatePinOrderRo) => {
  return axios.put(UPDATE_PIN_ORDER, data);
};
