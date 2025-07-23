import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const BUTTON_CLICK_WORKFLOW_CREATE = '/base/{baseId}/workflow/button-click-create';

export const buttonClickWorkflowCreateRoSchema = z.object({
  tableId: z.string(),
  watchFieldIds: z.array(z.string()),
});

export type IButtonClickWorkflowCreateRo = z.infer<typeof buttonClickWorkflowCreateRoSchema>;

export const WorkflowCreateWithTriggerRoute: RouteConfig = registerRoute({
  method: 'post',
  path: BUTTON_CLICK_WORKFLOW_CREATE,
  description: 'button click workflow create',
  summary: 'button click workflow create',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: buttonClickWorkflowCreateRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'button click workflow create successfully',
    },
  },
  tags: ['base'],
});

export const buttonClickWorkflowCreate = async (
  baseId: string,
  buttonClickWorkflowCreateRo: IButtonClickWorkflowCreateRo
) => {
  return await axios.post<unknown>(
    urlBuilder(BUTTON_CLICK_WORKFLOW_CREATE, {
      baseId,
    }),
    buttonClickWorkflowCreateRo
  );
};
