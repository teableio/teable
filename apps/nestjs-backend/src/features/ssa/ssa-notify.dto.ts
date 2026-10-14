import { NotificationSeverityEnum } from '@teable/core';
import { z } from 'zod';

/** Body accepted by `POST /api/ssa/notify` (internal, token-guarded). */
export const ssaNotifyRoSchema = z
  .object({
    toUserId: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    toEmail: z.union([z.string().email(), z.array(z.string().email()).min(1)]).optional(),
    message: z.string().min(1).max(2000),
    severity: z.enum(NotificationSeverityEnum).optional(),
    path: z.string().max(2000).optional(),
    fromUserId: z.string().optional(),
  })
  .refine((value) => Boolean(value.toUserId || value.toEmail), {
    message: 'One of `toUserId` or `toEmail` is required',
  });

export type ISsaNotifyRo = z.infer<typeof ssaNotifyRoSchema>;
