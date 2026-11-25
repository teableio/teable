import { recordInitiatorSchema } from '@teable/v2-core';
import type { IDurableProjectionContext } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

const attributionSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1),
  operationId: z.string().min(1),
  occurredAt: z.string().datetime(),
  context: z.object({
    actorId: z.string().min(1),
    initiator: recordInitiatorSchema.optional(),
    requestId: z.string().optional(),
    operationAttribution: z
      .object({
        operationId: z.string().min(1),
        occurredAt: z.string().datetime(),
        action: z.string().optional(),
        source: z.string().optional(),
        attributes: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
      })
      .optional(),
  }),
});

type FrozenContext = Pick<
  IDurableProjectionContext,
  'actorId' | 'initiator' | 'occurredAt' | 'operationId' | 'operationAttribution' | 'requestId'
>;

/** Missing historical envelopes stay unknown; malformed new envelopes must not be acknowledged. */
export const restoreProjectionAttribution = (value: unknown, eventId: string) => {
  if (value == null) return ok<FrozenContext>({ actorId: 'unknown', occurredAt: null });
  const parsed = attributionSchema.safeParse(value);
  if (!parsed.success || parsed.data.eventId !== eventId) {
    return err({
      code: 'domain_event.attribution_invalid',
      retryability: 'terminal' as const,
      message: 'Unsupported or malformed frozen attribution envelope',
    });
  }
  const envelope = parsed.data;
  return ok<FrozenContext>({
    actorId: envelope.context.actorId,
    initiator: envelope.context.initiator,
    requestId: envelope.context.requestId,
    operationAttribution: envelope.context.operationAttribution,
    operationId: envelope.operationId,
    occurredAt: new Date(envelope.occurredAt),
  });
};
