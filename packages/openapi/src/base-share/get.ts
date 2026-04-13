import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseShareMetaSchema } from './types';

export const GET_BASE_SHARE = '/share/{shareId}/base';

export const getBaseShareVoSchema = z.object({
  baseId: z.string(),
  shareMeta: baseShareMetaSchema,
  // Default URL for redirect, e.g. "/base/xxx/table/yyy/zzz"
  defaultUrl: z.string().optional(),
});

export type IGetBaseShareVo = z.infer<typeof getBaseShareVoSchema>;

export const GetBaseShareRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_SHARE,
  description: 'Get shared base information',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the shared base information',
      content: {
        'application/json': {
          schema: getBaseShareVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const getBaseShare = (shareId: string) => {
  return axios.get<IGetBaseShareVo>(urlBuilder(GET_BASE_SHARE, { shareId }));
};

// Get base share by nodeId
export const GET_BASE_SHARE_BY_NODE_ID = '/base/{baseId}/share/node/{nodeId}';

export const baseShareByNodeIdVoSchema = z.object({
  baseId: z.string(),
  shareId: z.string(),
  password: z.boolean(), // Only indicates if password is set, not the actual value
  nodeId: z.string().nullable(),
  allowSave: z.boolean().nullable(),
  allowCopy: z.boolean().nullable(),
  allowEdit: z.boolean().nullable(),
  enabled: z.boolean(),
});

export type IBaseShareByNodeIdVo = z.infer<typeof baseShareByNodeIdVoSchema>;

export const GetBaseShareByNodeIdRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_SHARE_BY_NODE_ID,
  description: 'Get a base share by node ID',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the base share for the specified node',
      content: {
        'application/json': {
          schema: baseShareByNodeIdVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const getBaseShareByNodeId = (baseId: string, nodeId: string) => {
  return axios.get<IBaseShareByNodeIdVo>(urlBuilder(GET_BASE_SHARE_BY_NODE_ID, { baseId, nodeId }));
};

// Get base-level share (nodeId = null)
export const GET_BASE_LEVEL_SHARE = '/base/{baseId}/share/node';

export const getBaseLevelShare = (baseId: string) => {
  return axios.get<IBaseShareByNodeIdVo | null>(urlBuilder(GET_BASE_LEVEL_SHARE, { baseId }));
};
