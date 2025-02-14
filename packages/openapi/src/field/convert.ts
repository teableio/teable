import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo, IConvertFieldRo } from '@teable/core';
import { fieldVoSchema, convertFieldRoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CONVERT_FIELD = '/table/{tableId}/field/{fieldId}/convert';

export const ConvertFieldRoute: RouteConfig = registerRoute({
  method: 'put',
  path: CONVERT_FIELD,
  summary: 'Convert field type',
  description:
    'Convert field to a different type with automatic type casting and symmetric field handling',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: convertFieldRoSchema.openapi({
            description:
              'Provide the complete field configuration including all properties, modified or not',
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns field data after update.',
      content: {
        'application/json': {
          schema: fieldVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const convertField = async (tableId: string, fieldId: string, fieldRo: IConvertFieldRo) => {
  return axios.put<IFieldVo>(
    urlBuilder(CONVERT_FIELD, {
      tableId,
      fieldId,
    }),
    fieldRo
  );
};
