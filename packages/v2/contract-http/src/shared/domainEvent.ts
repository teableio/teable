import type { IDomainEvent } from '@teable/v2-core';
import { z } from 'zod';

export const domainEventDtoSchema = z.object({
  name: z.string(),
  occurredAt: z.string(),
});

export type IDomainEventDto = z.infer<typeof domainEventDtoSchema>;

export const mapDomainEventToDto = (event: IDomainEvent): IDomainEventDto => ({
  name: event.name.toString(),
  occurredAt: event.occurredAt.toDate().toISOString(),
});
