import { oc as contractBuilder } from '@orpc/contract';
import { z } from 'zod';

/** Shared public error catalog; quota admission keeps its HTTP402 across every host surface. */
export const oc = contractBuilder.errors({
  PAYMENT_REQUIRED: { status: 402, data: z.unknown().optional() },
});
