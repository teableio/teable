import { z } from 'zod';
import { DeploymentStatus } from './constant';

const triggerSchema = z.object({
  id: z.string(),
  workflowTriggerTypeId: z.string(),
});

const actionsByIdEntrySchema = z.union([
  z.object({
    id: z.string(),
    workflowActionTypeId: z.string(),
    nextWorkflowActionId: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    workflowDecisionTypeId: z.string(),
    nextWorkflowNodeIds: z.array(z.string()),
  }),
]);

const graphSchema = z.object({
  id: z.string(),
  entryWorkflowActionId: z.string(),
  alwaysGroupName: z.string().optional(),
  alwaysGroupDescription: z.string().optional(),
  actionsById: z.record(actionsByIdEntrySchema),
});

const workflowItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  targetWorkflowDeploymentId: z.string().nullable(),
  deploymentStatus: z.nativeEnum(DeploymentStatus),
  trigger: triggerSchema,
  graph: graphSchema,
  // version: z.number(),
  // applicationId: z.string(),
  // liveWorkflowDeploymentVersion: z.string().nullable(),
  // deploymentError: z.string().nullable(),
  // origin: z.string().nullable(),
});

const workflowSectionItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  applicationId: z.string(),
  isDefaultSection: z.union([z.boolean(), z.null()]),
  workflowOrder: z.array(workflowItemSchema),
  // fractionalIndex: z.union([z.string(), z.null()]),
  // createdByUserId: z.string(),
});

// export const workflowSectionSchema = z.record(workflowSectionItemSchema);
export const workflowSectionSchema = z.array(workflowSectionItemSchema);

// const workFlowSchema = z.object({
//   workflowSections: workflowSectionsSchema,
// });

const workflowSchema = z.array(workflowItemSchema);

export type IWorkflowSection = z.infer<typeof workflowSectionSchema>;
export type IWorkFlowItem = z.infer<typeof workflowItemSchema>;
export type IWorkflow = z.infer<typeof workflowSchema>;
