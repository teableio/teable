import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const WORKFLOW_TRIGGER_FIRE = '/base/{baseId}/workflow/fire/{triggerType}';

export const buttonClickTriggerFireRoSchema = z.object({
  tableId: z.string(),
  fieldId: z.string(),
  recordId: z.string(),
});

export type IButtonClickTriggerFireRo = z.infer<typeof buttonClickTriggerFireRoSchema>;

export const workflowTriggerFireRoSchema = buttonClickTriggerFireRoSchema;

export type IWorkflowTriggerFireRo = z.infer<typeof workflowTriggerFireRoSchema>;

export const WorkflowTriggerRoute: RouteConfig = registerRoute({
  method: 'post',
  path: WORKFLOW_TRIGGER_FIRE,
  description: 'button click trigger',
  summary: 'button click trigger',
  request: {
    params: z.object({
      baseId: z.string(),
      triggerType: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: workflowTriggerFireRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'trigger a workflow successfully',
    },
  },
  tags: ['automation'],
});

export const workflowTriggerFire = async (
  baseId: string,
  triggerType: string,
  fireRo: IWorkflowTriggerFireRo
) => {
  return await axios.post<IWorkflowTriggerFireRo>(
    urlBuilder(WORKFLOW_TRIGGER_FIRE, {
      baseId,
      triggerType,
    }),
    fireRo
  );
};
