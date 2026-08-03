import { z } from 'zod';

export const computedOutboxWakeupWireSchema = z.object({
  schemaVersion: z.literal(1),
  wakeupId: z.string().min(1),
  taskId: z.string().min(1),
  baseId: z.string().min(1),
  availableAt: z.iso.datetime(),
  emittedAt: z.iso.datetime(),
  cause: z.enum(['created', 'merged', 'retry', 'replay']),
});

export type ComputedOutboxWakeupWire = z.infer<typeof computedOutboxWakeupWireSchema>;
