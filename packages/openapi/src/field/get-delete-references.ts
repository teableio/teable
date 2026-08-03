import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_FIELD_DELETE_REFERENCES = '/table/{tableId}/field/delete-references';

export const fieldDeleteReferencesQuerySchema = z.object({
  fieldIds: z.array(z.string()),
});

export type IFieldDeleteReferencesQuery = z.infer<typeof fieldDeleteReferencesQuerySchema>;

export const fieldDeleteRefBaseSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable().optional(),
});

export const fieldDeleteRefTableSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable().optional(),
  base: fieldDeleteRefBaseSourceSchema,
});

export const fieldDeleteRefWorkflowSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  base: fieldDeleteRefBaseSourceSchema,
});

export const fieldDeleteRefAuthorityMatrixSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const fieldDeleteRefViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  source: fieldDeleteRefTableSourceSchema,
});

export const fieldDeleteRefDependentFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  source: fieldDeleteRefTableSourceSchema,
});

export const fieldDeleteRefWorkflowNodeSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  type: z.string(),
  category: z.string(),
  source: fieldDeleteRefWorkflowSourceSchema,
});

export const fieldDeleteReferencesItemSchema = z.object({
  workflowNodes: z.array(fieldDeleteRefWorkflowNodeSchema),
  authorityMatrixRoles: z.array(fieldDeleteRefAuthorityMatrixSchema),
  views: z.array(fieldDeleteRefViewSchema),
  dependentFields: z.array(fieldDeleteRefDependentFieldSchema),
});

export type IFieldDeleteRefBaseSource = z.infer<typeof fieldDeleteRefBaseSourceSchema>;
export type IFieldDeleteRefTableSource = z.infer<typeof fieldDeleteRefTableSourceSchema>;
export type IFieldDeleteRefDependentField = z.infer<typeof fieldDeleteRefDependentFieldSchema>;
export type IFieldDeleteRefView = z.infer<typeof fieldDeleteRefViewSchema>;
export type IFieldDeleteReferencesItem = z.infer<typeof fieldDeleteReferencesItemSchema>;

export const fieldDeleteReferencesVoSchema = z.record(z.string(), fieldDeleteReferencesItemSchema);

export type IFieldDeleteReferencesVo = z.infer<typeof fieldDeleteReferencesVoSchema>;

export const getFieldDeleteReferencesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD_DELETE_REFERENCES,
  description: 'Get resources that reference the given fields (for delete impact analysis)',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: fieldDeleteReferencesQuerySchema,
  },
  responses: {
    200: {
      description: 'Returns the referenced resources for the given fields',
      content: {
        'application/json': {
          schema: fieldDeleteReferencesVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const getFieldDeleteReferences = async (tableId: string, fieldIds: string[]) => {
  return axios.get<IFieldDeleteReferencesVo>(urlBuilder(GET_FIELD_DELETE_REFERENCES, { tableId }), {
    params: { fieldIds },
  });
};
