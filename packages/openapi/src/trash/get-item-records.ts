import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema } from '@teable/core';
import { axios } from '../axios';
import {
  registerRoute,
  serializeArrayAwareQuery,
  stringOrArrayQuerySchema,
  urlBuilder,
} from '../utils';
import { z } from '../zod';
import { userMapVoSchema } from './get';

export const GET_TRASH_ITEM_RECORDS = '/trash/{trashId}/records';

export const MAX_TRASH_ITEM_RECORDS_TAKE = 200;

export const getTrashItemRecordsQuerySchema = z.object({
  tableId: z.string(),
  // Opaque continuation cursor from the previous page's nextCursor. Pages walk the item's
  // snapshots in deletion order (newest first); snapshots may live in hot or cold storage,
  // so random access by position is not supported.
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(MAX_TRASH_ITEM_RECORDS_TAKE).optional(),
  // Record-level filters narrow the walked stream; a page may return fewer items than
  // `take` while more matches remain (nextCursor keeps paging). Keyword search is
  // deliberately absent: snapshots live in hot or cold storage, and cold storage can
  // only be scanned, not queried — same rule as record history.
  recordCreatedBy: stringOrArrayQuerySchema,
  recordCreatedTimeStart: z.string().optional(),
  recordCreatedTimeEnd: z.string().optional(),
});

export type IGetTrashItemRecordsQuery = z.infer<typeof getTrashItemRecordsQuerySchema>;

export const trashItemRecordVoSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  record: recordSchema,
  deletedTime: z.string(),
  deletedBy: z.string(),
  recordCreatedTime: z.string().nullish(),
  recordCreatedBy: z.string().nullish(),
  recordLastModifiedTime: z.string().nullish(),
  recordLastModifiedBy: z.string().nullish(),
});

export type ITrashItemRecordVo = z.infer<typeof trashItemRecordVoSchema>;

export const getTrashItemRecordsVoSchema = z.object({
  items: z.array(trashItemRecordVoSchema),
  userMap: userMapVoSchema,
  // null = the item's snapshot stream is exhausted; otherwise pass back as `cursor`.
  nextCursor: z.string().nullish(),
});

export type IGetTrashItemRecordsVo = z.infer<typeof getTrashItemRecordsVoSchema>;

export const GetTrashItemRecordsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TRASH_ITEM_RECORDS,
  summary: 'Get deleted record snapshots of a trash item',
  description:
    'List the record snapshots contained in a record-type table trash item in deletion order (newest first), cursor-paginated across hot and cold storage. Record-level filters narrow the stream. Records that were restored or permanently deleted are omitted.',
  request: {
    params: z.object({
      trashId: z.string(),
    }),
    query: getTrashItemRecordsQuerySchema,
  },
  responses: {
    200: {
      description: 'Get trash item records successfully',
      content: {
        'application/json': {
          schema: getTrashItemRecordsVoSchema,
        },
      },
    },
  },
  tags: ['trash'],
});

export const getTrashItemRecords = (trashId: string, query: IGetTrashItemRecordsQuery) => {
  return axios.get<IGetTrashItemRecordsVo>(urlBuilder(GET_TRASH_ITEM_RECORDS, { trashId }), {
    params: query,
    paramsSerializer: serializeArrayAwareQuery,
  });
};
