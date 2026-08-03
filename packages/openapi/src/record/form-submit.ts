import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema, type IRecord } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const formSubmitRoSchema = z.object({
  viewId: z.string().describe('Form view ID'),
  fields: recordSchema.shape.fields,
  typecast: z.boolean().optional(),
});

export type IFormSubmitRo = z.infer<typeof formSubmitRoSchema>;

export const FORM_SUBMIT = '/table/{tableId}/record/form-submit';

export const FormSubmitRoute: RouteConfig = registerRoute({
  method: 'post',
  path: FORM_SUBMIT,
  summary: 'Submit form',
  description:
    'Submit a record through a form view. This will trigger "When form submitted" automations.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: formSubmitRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns the created record.',
      content: {
        'application/json': {
          schema: recordSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function formSubmit(
  tableId: string,
  formSubmitRo: IFormSubmitRo
): Promise<AxiosResponse<IRecord>> {
  return axios.post<IRecord>(urlBuilder(FORM_SUBMIT, { tableId }), formSubmitRo);
}
