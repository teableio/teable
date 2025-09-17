import type { ReadStream } from 'fs';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord } from '@teable/core';
import { recordSchema } from '@teable/core';
import FormData from 'form-data';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

import { z } from '../zod';

export const UPLOAD_ATTACHMENT_URL =
  '/table/{tableId}/record/{recordId}/{fieldId}/uploadAttachment';

export const UploadAttachmentRoute: RouteConfig = registerRoute({
  method: 'post',
  path: UPLOAD_ATTACHMENT_URL,
  summary: 'Upload attachment',
  description: 'Upload an attachment from a file or URL and append it to the cell',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      fieldId: z.string().openapi({ description: 'ID of an attachment field' }),
    }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().optional().openapi({ type: 'string', format: 'binary' }),
            fileUrl: z.string().optional(),
          }),
        },
      },
      description: 'upload attachment',
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

export const uploadAttachment = async (
  tableId: string,
  recordId: string,
  fieldId: string,
  file?: Buffer | ReadStream | string,
  options?: FormData.AppendOptions | string
) => {
  const formData = new FormData();

  if (typeof file === 'string') {
    formData.append('fileUrl', file);
  } else if (file) {
    formData.append('file', file, options);
  }

  return axios.post<IRecord>(
    urlBuilder(UPLOAD_ATTACHMENT_URL, { tableId, recordId, fieldId }),
    formData,
    {
      headers: {
        ...formData.getHeaders(),
      },
    }
  );
};
