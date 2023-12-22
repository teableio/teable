import { createSpaceVoSchema } from '@teable-group/openapi';
import { z } from 'zod';
import { coreEventSchema } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

export const spaceCreateEventSchema = coreEventSchema.extend({
  name: z.nativeEnum(Events).default(Events.SPACE_CREATE),
  isBatch: z.boolean().default(false),
  space: createSpaceVoSchema,
});

export type ISpaceCreateEvent = z.infer<typeof spaceCreateEventSchema>;

export const spaceDeleteEventSchema = coreEventSchema.extend({
  name: z.nativeEnum(Events).default(Events.SPACE_DELETE),
  isBatch: z.boolean().default(false),
  spaceId: z.string(),
});

export type ISpaceDeleteEvent = z.infer<typeof spaceDeleteEventSchema>;

export const spaceUpdateEventSchema = spaceCreateEventSchema.extend({
  name: z.nativeEnum(Events).default(Events.SPACE_UPDATE),
});

export type ISpaceUpdateEvent = z.infer<typeof spaceUpdateEventSchema>;

export const spaceEventSchema = z.discriminatedUnion('name', [
  spaceCreateEventSchema.extend({ name: z.literal(Events.SPACE_CREATE) }),
  spaceDeleteEventSchema.extend({ name: z.literal(Events.SPACE_DELETE) }),
  spaceUpdateEventSchema.extend({ name: z.literal(Events.SPACE_UPDATE) }),
]);

export type ISpaceEvent = z.infer<typeof spaceEventSchema>;
