import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TABLE_SEARCH_INDEX_POLICY = '/base/{baseId}/table/{tableId}/index/policy';

export const tableSearchIndexScopeSchema = z.enum(['all_fields', 'selected_fields']);

export const tableSearchIndexPolicyRoSchema = z.object({
  searchScope: tableSearchIndexScopeSchema,
  fields: z.array(z.string()).default([]),
});

export type ITableSearchIndexPolicyRo = z.infer<typeof tableSearchIndexPolicyRoSchema>;

export const tableSearchIndexPolicyVoSchema = z.object({
  version: z.literal(1),
  searchScope: tableSearchIndexScopeSchema,
  fields: z.array(z.string()),
});

export type ITableSearchIndexPolicyVo = z.infer<typeof tableSearchIndexPolicyVoSchema>;

export const GetTableSearchIndexPolicyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: TABLE_SEARCH_INDEX_POLICY,
  summary: 'Get table search index policy',
  description: 'Get which fields participate in the table search index.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Table search index policy',
      content: {
        'application/json': {
          schema: tableSearchIndexPolicyVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const UpdateTableSearchIndexPolicyRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TABLE_SEARCH_INDEX_POLICY,
  summary: 'Update table search index policy',
  description:
    'Select all eligible fields or an explicit subset for the v1 idx_trgm search index. When the search index is active, applying the policy rebuilds it. Under selected_fields, newly created fields are not indexed until the policy includes them.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: tableSearchIndexPolicyRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated table search index policy',
      content: {
        'application/json': {
          schema: tableSearchIndexPolicyVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableSearchIndexPolicy = async (baseId: string, tableId: string) => {
  return axios.get<ITableSearchIndexPolicyVo>(
    urlBuilder(TABLE_SEARCH_INDEX_POLICY, { baseId, tableId })
  );
};

export const updateTableSearchIndexPolicy = async (
  baseId: string,
  tableId: string,
  policy: ITableSearchIndexPolicyRo
) => {
  return axios.put<ITableSearchIndexPolicyVo>(
    urlBuilder(TABLE_SEARCH_INDEX_POLICY, { baseId, tableId }),
    policy
  );
};
