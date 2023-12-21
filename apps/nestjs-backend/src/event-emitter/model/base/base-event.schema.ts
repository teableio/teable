import { createBaseVoSchema } from '@teable-group/openapi';
import { z } from 'zod';
import { coreEventSchema } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

export const baseCreateEventSchema = coreEventSchema.extend({
  name: z.nativeEnum(Events).default(Events.BASE_CREATE),
  isBatch: z.boolean().default(false),
  base: createBaseVoSchema,
});

export type IBaseCreateEvent = z.infer<typeof baseCreateEventSchema>;

export const baseDeleteEventSchema = coreEventSchema.extend({
  name: z.nativeEnum(Events).default(Events.BASE_DELETE),
  isBatch: z.boolean().default(false),
  baseId: z.string(),
});

export type IBaseDeleteEvent = z.infer<typeof baseDeleteEventSchema>;

export const baseUpdateEventSchema = baseCreateEventSchema.extend({
  name: z.nativeEnum(Events).default(Events.BASE_UPDATE),
});

export type IBaseUpdateEvent = z.infer<typeof baseUpdateEventSchema>;

export const baseEventSchema = z.discriminatedUnion('name', [
  baseCreateEventSchema.extend({ name: z.literal(Events.BASE_CREATE) }),
  baseDeleteEventSchema.extend({ name: z.literal(Events.BASE_DELETE) }),
  baseUpdateEventSchema.extend({ name: z.literal(Events.BASE_UPDATE) }),
]);

export type IBaseEvent = z.infer<typeof baseEventSchema>;
