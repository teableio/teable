import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { PinType } from './types';

export const DELETE_PIN = '/pin';

export const deletePinRoSchema = z.object({
  type: z.nativeEnum(PinType),
  id: z.string(),
});

export type DeletePinRo = z.infer<typeof deletePinRoSchema>;

export const DeletePinRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_PIN,
  description: 'Delete pin',
  request: {
    query: deletePinRoSchema,
  },
  responses: {
    200: {
      description: 'Delete pin successfully',
    },
  },
  tags: ['pin'],
});

export const deletePin = (data: DeletePinRo) => {
  return axios.delete(DELETE_PIN, {
    params: data,
  });
};
