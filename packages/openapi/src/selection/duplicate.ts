import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { rangesRoSchema } from './range';
export const DUPLICATE_URL = '/table/{tableId}/selection/duplicate';

export const duplicateVoSchema = z.object({
  ids: z.array(z.string()),
});

export const duplicateRoSchema = rangesRoSchema.extend({
  anchorId: z.string().openapi({
    description: 'The record id to anchor to',
  }),
  position: z.enum(['before', 'after']),
});

export type IDuplicateVo = z.infer<typeof duplicateVoSchema>;
export type IDuplicateRo = z.infer<typeof duplicateRoSchema>;
export const duplicateRoute = registerRoute({
  method: 'post',
  path: DUPLICATE_URL,
  description: 'Duplicate the selected data',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: duplicateRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successful duplicate',
    },
  },
  tags: ['selection'],
});

export const duplicate = async (tableId: string, duplicateRo: IDuplicateRo) => {
  return axios.post<IDuplicateVo>(urlBuilder(DUPLICATE_URL, { tableId }), duplicateRo);
};
