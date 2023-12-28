import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldRo } from '@teable-group/core';
import { fieldRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { graphVoSchema } from '../table/get-cell-graph';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CREATE_FIELD_PLAIN = '/table/{tableId}/field/plain';

export const createFieldPlainVoSchema = z.object({
  isAsync: z.boolean(),
  graph: graphVoSchema,
  updateCellCount: z.number(),
  totalCellCount: z.number(),
});

export type ICreateFieldPlainVo = z.infer<typeof createFieldPlainVoSchema>;

export const CreateFieldPlainRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_FIELD_PLAIN,
  description: 'Generate calculation plain for creating the field',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: fieldRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns the calculation plan for creating the field',
      content: {
        'application/json': {
          schema: createFieldPlainVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const createFieldPlain = async (tableId: string, fieldRo: IFieldRo) => {
  return axios.post<ICreateFieldPlainVo>(urlBuilder(CREATE_FIELD_PLAIN, { tableId }), fieldRo);
};
