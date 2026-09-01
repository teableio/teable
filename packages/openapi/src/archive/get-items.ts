import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema } from '@teable/core';
import { axios } from '../axios';
import { userMapVoSchema } from '../trash';
import {
  registerRoute,
  serializeArrayAwareQuery,
  stringOrArrayQuerySchema,
  urlBuilder,
} from '../utils';
import { z } from '../zod';

export const GET_ARCHIVE_ITEMS = '/table/{tableId}/archive/items';

export const archiveOrderBySchema = z.enum([
  'archivedTime',
  'recordCreatedTime',
  'recordLastModifiedTime',
]);

export type IArchiveOrderBy = z.infer<typeof archiveOrderBySchema>;

export const getArchiveItemsQuerySchema = z.object({
  cursor: z.string().nullish(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  orderBy: archiveOrderBySchema.optional(),
  // desc only: the dual-zone list serves PG first, and under asc every
  // over-horizon cold row would belong before it
  direction: z.literal('desc').optional(),
  // Keyword search is deliberately absent: archived snapshots live mostly in cold
  // storage, which can only be scanned, not queried — same rule as record history.
  recordCreatedBy: stringOrArrayQuerySchema,
  recordLastModifiedBy: stringOrArrayQuerySchema,
  archivedTimeStart: z.string().optional(),
  archivedTimeEnd: z.string().optional(),
  recordCreatedTimeStart: z.string().optional(),
  recordCreatedTimeEnd: z.string().optional(),
});

export type IGetArchiveItemsQuery = z.infer<typeof getArchiveItemsQuerySchema>;

export const archiveItemVoSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  record: recordSchema,
  archivedTime: z.string(),
  archivedBy: z.string(),
  recordCreatedTime: z.string().nullish(),
  recordCreatedBy: z.string().nullish(),
  recordLastModifiedTime: z.string().nullish(),
  recordLastModifiedBy: z.string().nullish(),
});

export type IArchiveItemVo = z.infer<typeof archiveItemVoSchema>;

export const getArchiveItemsVoSchema = z.object({
  items: z.array(archiveItemVoSchema),
  userMap: userMapVoSchema,
  nextCursor: z.string().nullish(),
});

export type IGetArchiveItemsVo = z.infer<typeof getArchiveItemsVoSchema>;

export const GetArchiveItemsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_ARCHIVE_ITEMS,
  summary: 'Get archived records',
  description:
    'List archived records of a table with fixed-dimension filters (archived time, record created time/by, record last modified by) and cursor pagination.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: getArchiveItemsQuerySchema,
  },
  responses: {
    200: {
      description: 'Get archived records successfully',
      content: {
        'application/json': {
          schema: getArchiveItemsVoSchema,
        },
      },
    },
  },
  tags: ['archive'],
});

export const getArchiveItems = async (tableId: string, query: IGetArchiveItemsQuery) => {
  return axios.get<IGetArchiveItemsVo>(urlBuilder(GET_ARCHIVE_ITEMS, { tableId }), {
    params: query,
    paramsSerializer: serializeArrayAwareQuery,
  });
};
