import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TABLE_QUERY_INDEX_POLICY = '/base/{baseId}/table/{tableId}/index/query-policy';

export const queryIndexDirectionSchema = z.enum(['asc', 'desc']);

export const queryIndexFieldColumnSchema = z.object({
  kind: z.literal('field'),
  fieldId: z.string(),
  direction: queryIndexDirectionSchema,
});

export const queryIndexCoalesceColumnSchema = z.object({
  kind: z.literal('coalesce'),
  fieldIds: z.array(z.string()).min(2).max(4),
  direction: queryIndexDirectionSchema,
});

export const queryIndexColumnSchema = z.discriminatedUnion('kind', [
  queryIndexFieldColumnSchema,
  queryIndexCoalesceColumnSchema,
]);

export const queryIndexSpecSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  columns: z.array(queryIndexColumnSchema).min(1).max(8),
});

export type ITableQueryIndexSpec = z.infer<typeof queryIndexSpecSchema>;

export const tableQueryIndexPolicyRoSchema = z.object({
  indexes: z.array(queryIndexSpecSchema).max(8),
});

export type ITableQueryIndexPolicyRo = z.infer<typeof tableQueryIndexPolicyRoSchema>;

export const tableQueryIndexPolicyVoSchema = z.object({
  version: z.literal(1),
  indexes: z.array(queryIndexSpecSchema),
});

export type ITableQueryIndexPolicyVo = z.infer<typeof tableQueryIndexPolicyVoSchema>;

export const GetTableQueryIndexPolicyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: TABLE_QUERY_INDEX_POLICY,
  summary: 'Get table query index policy',
  description: 'Get the backend-managed btree indexes for table read queries.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Table query index policy',
      content: {
        'application/json': {
          schema: tableQueryIndexPolicyVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const UpdateTableQueryIndexPolicyRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TABLE_QUERY_INDEX_POLICY,
  summary: 'Update table query index policy',
  description:
    'Replace the backend-managed btree indexes for table read queries. Applying the policy drops and recreates the managed idx_qry_ indexes.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: tableQueryIndexPolicyRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated table query index policy',
      content: {
        'application/json': {
          schema: tableQueryIndexPolicyVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableQueryIndexPolicy = async (baseId: string, tableId: string) => {
  return axios.get<ITableQueryIndexPolicyVo>(
    urlBuilder(TABLE_QUERY_INDEX_POLICY, { baseId, tableId })
  );
};

export const updateTableQueryIndexPolicy = async (
  baseId: string,
  tableId: string,
  policy: ITableQueryIndexPolicyRo
) => {
  return axios.put<ITableQueryIndexPolicyVo>(
    urlBuilder(TABLE_QUERY_INDEX_POLICY, { baseId, tableId }),
    policy
  );
};
