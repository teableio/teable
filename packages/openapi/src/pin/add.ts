import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { PinType } from './types';

export const ADD_PIN = '/pin/';

export const addPinRoSchema = z.object({
  type: z.nativeEnum(PinType),
  id: z.string(),
});

export type AddPinRo = z.infer<typeof addPinRoSchema>;

export const AddPinRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ADD_PIN,
  description: 'Add pin',
  request: {
    body: {
      content: {
        'application/json': {
          schema: addPinRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Add pin successfully',
    },
  },
  tags: ['pin'],
});

export const addPin = (data: AddPinRo) => {
  return axios.post(ADD_PIN, data);
};
