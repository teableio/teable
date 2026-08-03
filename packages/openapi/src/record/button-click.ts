import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const BUTTON_CLICK = '/table/{tableId}/record/{recordId}/{fieldId}/button-click';

export const buttonClickVoSchema = z.object({
  runId: z.string(),
  tableId: z.string(),
  fieldId: z.string(),
  record: recordSchema,
});

export type IButtonClickVo = z.infer<typeof buttonClickVoSchema>;

export const ButtonClickRoute: RouteConfig = registerRoute({
  method: 'post',
  path: BUTTON_CLICK,
  summary: 'Button click',
  description: 'Button click',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the clicked cell',
      content: {
        'application/json': {
          schema: buttonClickVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function buttonClick(
  tableId: string,
  recordId: string,
  fieldId: string
): Promise<AxiosResponse<IButtonClickVo>> {
  return axios.post<IButtonClickVo>(urlBuilder(BUTTON_CLICK, { tableId, recordId, fieldId }));
}
