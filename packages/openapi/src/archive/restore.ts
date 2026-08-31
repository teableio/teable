import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { archiveRecordIdsRoSchema } from './archive';

export const RESTORE_ARCHIVE_RECORDS = '/table/{tableId}/archive/restore';

export const restoreArchiveRecordsRoSchema = archiveRecordIdsRoSchema;

export type IRestoreArchiveRecordsRo = z.infer<typeof restoreArchiveRecordsRoSchema>;

export const restoreArchiveRecordsVoSchema = z.object({
  restoredRecordIds: z.array(z.string()),
});

export type IRestoreArchiveRecordsVo = z.infer<typeof restoreArchiveRecordsVoSchema>;

export const RestoreArchiveRecordsRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RESTORE_ARCHIVE_RECORDS,
  summary: 'Restore archived records',
  description: 'Rebuild archived records back into the table from their archive snapshots.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: restoreArchiveRecordsRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Restored successfully',
      content: {
        'application/json': {
          schema: restoreArchiveRecordsVoSchema,
        },
      },
    },
  },
  tags: ['archive'],
});

export const restoreArchiveRecords = async (
  tableId: string,
  restoreRo: IRestoreArchiveRecordsRo
) => {
  return axios.post<IRestoreArchiveRecordsVo>(
    urlBuilder(RESTORE_ARCHIVE_RECORDS, { tableId }),
    restoreRo
  );
};
