import { OpName } from '@teable-group/core';
import { z } from 'zod';
import { Events } from '../model';

export const eventContextSchema = z.object({
  user: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    })
    .optional(),
  headers: z.record(z.string()).optional(),
  opMeta: z
    .object({
      name: z.nativeEnum(OpName).optional(),
      propertyKey: z.string(),
    })
    .partial()
    .optional(),
});

export type IEventContext = z.infer<typeof eventContextSchema>;

export const coreEventSchema = z.object({
  name: z.nativeEnum(Events),
  context: eventContextSchema,
  isBatch: z.boolean().optional(),
});

export type ICoreEvent = z.infer<typeof coreEventSchema>;
