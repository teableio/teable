import { z } from 'zod';
import { axios } from '../axios';

export const importStatusVoSchema = z.object({
  tableId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'not_found']),
  successCount: z.number().optional(),
  failedCount: z.number().optional(),
  message: z.string().optional(),
  errorReportUrl: z.string().optional(),
});

export type IImportStatusVo = z.infer<typeof importStatusVoSchema>;

export const GET_IMPORT_STATUS = '/import/status/{tableId}';

export const getImportStatus = (tableId: string) =>
  axios.get<IImportStatusVo>(GET_IMPORT_STATUS.replace('{tableId}', tableId));
