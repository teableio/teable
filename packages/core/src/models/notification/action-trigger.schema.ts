import { z } from 'zod';

export const actionTriggerBufferValue = z.object({
  addRecord: z.string().array().optional(),
  setRecord: z.string().array().optional(),
  deleteRecord: z.string().array().optional(),

  addField: z.string().array().optional(),
  setField: z.string().array().optional(),

  applyViewFilter: z.string().array().optional(),
  applyViewGroup: z.string().array().optional(),
  applyViewStatisticFunc: z.string().array().optional(),
  showViewField: z.string().array().optional(),
});

export const actionTriggerBufferSchema = actionTriggerBufferValue;

export type IActionTriggerBuffer = z.infer<typeof actionTriggerBufferSchema>;
