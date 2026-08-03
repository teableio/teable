import { axios } from '../../axios';
import { urlBuilder } from '../../utils';
import { z } from '../../zod';

const workflowVoSchema = z.unknown();
type IWorkflowVo = z.infer<typeof workflowVoSchema>;

const CREATE_WORKFLOW = '/base/{baseId}/workflow';

const workflowRoSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  trigger: z.unknown().optional(),
});

type IWorkflowRo = z.infer<typeof workflowRoSchema>;

export const createWorkflow = async (baseId: string, createWorkflowRo?: IWorkflowRo) => {
  return axios.post<IWorkflowVo>(urlBuilder(CREATE_WORKFLOW, { baseId }), createWorkflowRo);
};
