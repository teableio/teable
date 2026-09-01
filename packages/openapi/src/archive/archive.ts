import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const ARCHIVE_RECORDS = '/table/{tableId}/record/archive';

// Cap for the plain (non-stream) archive endpoints; clients switch to the SSE stream
// endpoint above it.
export const MAX_ARCHIVE_RECORDS_PER_REQUEST = 1000;

export const archiveRecordIdSchema = z.string().startsWith(IdPrefix.Record);

// Shared body of the plain archive / restore / delete endpoints.
export const archiveRecordIdsRoSchema = z.object({
  recordIds: z.array(archiveRecordIdSchema).min(1).max(MAX_ARCHIVE_RECORDS_PER_REQUEST),
});

export const archiveRecordsRoSchema = archiveRecordIdsRoSchema;

export type IArchiveRecordsRo = z.infer<typeof archiveRecordsRoSchema>;

export const archiveRecordsVoSchema = z.object({
  archivedRecordIds: z.array(z.string()),
});

export type IArchiveRecordsVo = z.infer<typeof archiveRecordsVoSchema>;

export const ArchiveRecordsRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ARCHIVE_RECORDS,
  summary: 'Archive records',
  description:
    'Move records out of the table into the archive. Archived records are read-only and can be restored from the archive.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: archiveRecordsRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Archived successfully',
      content: {
        'application/json': {
          schema: archiveRecordsVoSchema,
        },
      },
    },
  },
  tags: ['archive'],
});

export const archiveRecords = async (tableId: string, archiveRo: IArchiveRecordsRo) => {
  return axios.post<IArchiveRecordsVo>(urlBuilder(ARCHIVE_RECORDS, { tableId }), archiveRo);
};
