import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { FieldType, fieldVoSchema, Relationship } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const BASE_ERD = '/base/{baseId}/erd';

export const baseErdTableNodeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.string().optional(),
    crossBaseId: z.string().optional(),
    crossBaseName: z.string().optional(),
    fields: fieldVoSchema
      .pick({
        id: true,
        name: true,
        type: true,
        isLookup: true,
        isPrimary: true,
      })
      .array(),
  })
  .passthrough();

export type IBaseErdTableNode = z.infer<typeof baseErdTableNodeSchema>;

export const baseErdEdgeSchema = z.object({
  source: z.object({
    tableId: z.string(),
    tableName: z.string(),
    fieldId: z.string(),
    fieldName: z.string(),
  }),
  target: z.object({
    tableId: z.string(),
    tableName: z.string(),
    fieldId: z.string(),
    fieldName: z.string(),
  }),
  relationship: z.nativeEnum(Relationship).optional(),
  isOneWay: z.boolean().optional(),
  type: z.nativeEnum(FieldType).or(z.literal('lookup')),
});

export type IBaseErdEdge = z.infer<typeof baseErdEdgeSchema>;

export const baseErdVoSchema = z.object({
  baseId: z.string(),
  nodes: z.array(baseErdTableNodeSchema),
  edges: z.array(baseErdEdgeSchema),
});

export type IBaseErdVo = z.infer<typeof baseErdVoSchema>;

export const getBaseErdRoute: RouteConfig = registerRoute({
  method: 'get',
  path: BASE_ERD,
  description: 'Get the erd of a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the erd of a base.',
      content: {
        'application/json': {
          schema: baseErdVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseErd = async (baseId: string) => {
  return axios.get<IBaseErdVo>(urlBuilder(BASE_ERD, { baseId }));
};
