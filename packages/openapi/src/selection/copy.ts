import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { selectionIdMutationBaseRoSchema, type ISelectionIdMutationBaseRo } from './id-mutation';
import type { IRangesRo } from './range';
import { rangesQuerySchema } from './range';

export const COPY_URL = '/table/{tableId}/selection/copy';
export const COPY_BY_ID_URL = '/table/{tableId}/selection/copy-by-id';

export const copyVoSchema = z.object({
  content: z.string(),
  header: fieldVoSchema.array(),
});

export type ICopyVo = z.infer<typeof copyVoSchema>;

export const copyByIdRoSchema = selectionIdMutationBaseRoSchema;
export type ICopyByIdRo = ISelectionIdMutationBaseRo;

export const CopyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: COPY_URL,
  summary: 'Copy selected table content',
  description: 'Copy content from selected table ranges including headers if specified',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: rangesQuerySchema,
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: copyVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const CopyByIdRoute: RouteConfig = registerRoute({
  method: 'post',
  path: COPY_BY_ID_URL,
  summary: 'Copy selected table content by record and field ids',
  description: 'Copy content using record and field identifiers instead of row ranges.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: copyByIdRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: copyVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const copy = async (tableId: string, copyRo: IRangesRo) => {
  return axios.get<ICopyVo>(
    urlBuilder(COPY_URL, {
      tableId,
    }),
    {
      params: {
        ...copyRo,
        filter: JSON.stringify(copyRo.filter),
        orderBy: JSON.stringify(copyRo.orderBy),
        groupBy: JSON.stringify(copyRo.groupBy),
        ranges: JSON.stringify(copyRo.ranges),
        collapsedGroupIds: JSON.stringify(copyRo.collapsedGroupIds),
      },
    }
  );
};

export const copyById = async (tableId: string, copyRo: ICopyByIdRo) => {
  return axios.post<ICopyVo>(
    urlBuilder(COPY_BY_ID_URL, {
      tableId,
    }),
    copyRo
  );
};
