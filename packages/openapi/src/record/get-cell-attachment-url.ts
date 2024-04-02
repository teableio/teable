import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_CELL_ATTACHMENT_URL =
  '/table/{tableId}/record/{recordId}/{fieldId}/attachment-url';

export const getCellAttachmentUrlVoSchema = z.record(z.string(), z.string());

export type GetCellAttachmentUrlVo = z.infer<typeof getCellAttachmentUrlVoSchema>;

export const GetCellAttachmentUrlRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_CELL_ATTACHMENT_URL,
  description: 'Get signed attachment url from cell',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'a cellValue attachment url',
      content: {
        'application/json': {
          schema: getCellAttachmentUrlVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const GetAttachmentUrl = async (tableId: string, fieldId: string, recordId: string) => {
  return axios.get<GetCellAttachmentUrlVo>(
    urlBuilder(GET_CELL_ATTACHMENT_URL, {
      tableId,
      fieldId,
      recordId,
    })
  );
};
