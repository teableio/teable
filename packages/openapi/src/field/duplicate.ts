import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo } from '@teable/core';
import { fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_FIELD = '/table/{tableId}/field/{fieldId}/duplicate';

export const duplicateFieldRoSchema = z.object({
  name: z.string(),
  viewId: z.string().optional(),
});

export type IDuplicateFieldRo = z.infer<typeof duplicateFieldRoSchema>;

export const DuplicateFieldRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_FIELD,
  summary: 'Duplicate field',
  description: 'Duplicate field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: duplicateFieldRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns duplicated field data',
      content: {
        'application/json': {
          schema: fieldVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const duplicateField = async (
  tableId: string,
  fieldId: string,
  duplicateFieldRo: IDuplicateFieldRo
) => {
  return axios.post<IFieldVo>(urlBuilder(DUPLICATE_FIELD, { tableId, fieldId }), duplicateFieldRo);
};
