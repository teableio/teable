import { z } from 'zod';

export const actionTriggerBufferValue = z.object({
  tableAdd: z.string().array().optional(),
  tableUpdate: z.string().array().optional(),
  tableDelete: z.string().array().optional(),
  applyViewFilter: z.string().array().optional(),
  showViewField: z.string().array().optional(),
});

export const actionTriggerBufferSchema = actionTriggerBufferValue;

export type IActionTriggerBuffer = z.infer<typeof actionTriggerBufferSchema>;
