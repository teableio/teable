import { z } from 'zod';

export const computedOutboxWakeupWireSchema = z.object({
  schemaVersion: z.literal(1),
  wakeupId: z.string().min(1),
  taskId: z.string().min(1),
  baseId: z.string().min(1),
  availableAt: z.iso.datetime(),
  emittedAt: z.iso.datetime(),
  cause: z.enum(['created', 'merged', 'retry', 'replay']),
  // Optional W3C carrier so worker spans join the originating write trace.
  traceparent: z.string().min(1).optional(),
  tracestate: z.string().min(1).optional(),
});

export type ComputedOutboxWakeupWire = z.infer<typeof computedOutboxWakeupWireSchema>;
