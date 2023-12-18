import { z } from 'zod';

export const actionTriggerBufferValue = z.object({
  fetchRowCount: z.string().array().optional(),
  fetchAggregation: z.string().array().optional(),
});

export const actionTriggerBufferSchema = actionTriggerBufferValue;

export type IActionTriggerBuffer = z.infer<typeof actionTriggerBufferSchema>;
