import { z } from 'zod';

export const actionTriggerBufferValue = z.object({
  fetchRowCount: z.boolean().optional(),
  fetchAggregation: z.boolean().optional(),
});

export const actionTriggerBufferSchema = z.union([
  actionTriggerBufferValue,
  z.record(z.string(), actionTriggerBufferValue),
]);

export type IActionTriggerBuffer = z.infer<typeof actionTriggerBufferSchema>;
