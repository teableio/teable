import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IAttachmentItem, IRecord } from '@teable/core';
import { attachmentItemSchema, recordSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

import { z } from '../zod';

export const INSERT_ATTACHMENT_URL =
  '/table/{tableId}/record/{recordId}/{fieldId}/insertAttachment';

export const insertAttachmentRoSchema = z.object({
  attachments: z.array(attachmentItemSchema).min(1),
  anchorId: z.string().optional(),
});

export type IInsertAttachmentRo = z.infer<typeof insertAttachmentRoSchema>;

export const InsertAttachmentRoute: RouteConfig = registerRoute({
  method: 'post',
  path: INSERT_ATTACHMENT_URL,
  summary: 'Insert attachments at anchor',
  description:
    'Insert attachments after the anchor in the cell (append to end if anchor not found or not provided)',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      fieldId: z.string().meta({ description: 'ID of an attachment field' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: insertAttachmentRoSchema,
        },
      },
      description: 'Attachments to insert and optional anchor position',
      required: true,
    },
  },
  responses: {
    201: {
      description: 'Returns record data after update.',
      content: {
        'application/json': {
          schema: recordSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const insertAttachment = async (
  tableId: string,
  recordId: string,
  fieldId: string,
  attachments: IAttachmentItem[],
  anchorId?: string
) => {
  return axios.post<IRecord>(urlBuilder(INSERT_ATTACHMENT_URL, { tableId, recordId, fieldId }), {
    attachments,
    anchorId,
  } satisfies IInsertAttachmentRo);
};
