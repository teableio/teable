import { err, ok } from 'neverthrow';
import { z } from 'zod';

import { domainError } from '../../domain/shared/DomainError';
import { ViewDeleted } from '../../domain/table/events/ViewDeleted';
import type { EventType } from '../../ports/EventHandler';
import type { IProjectionMessageCodec } from '../../ports/ProjectionMessage';

const payloadSchema = z
  .object({
    tableId: z.string(),
    baseId: z.string(),
    viewId: z.string(),
    oldVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

type ViewDeletedProjectionPayload = z.infer<typeof payloadSchema>;

/** Retained view data stays in the metadata DB; trash only needs its stable identity. */
export const viewDeletedProjectionCodec: IProjectionMessageCodec<
  ViewDeleted,
  ViewDeletedProjectionPayload
> = {
  eventType: ViewDeleted as EventType<ViewDeleted>,
  messageName: 'table.view.deleted.v1',
  schemaVersion: 1,
  encode: (event) =>
    ok({
      tableId: event.tableId.toString(),
      baseId: event.baseId.toString(),
      viewId: event.viewId.toString(),
      ...(event.oldVersion !== undefined ? { oldVersion: event.oldVersion } : {}),
    }),
  decode: (payload) => {
    const parsed = payloadSchema.safeParse(payload);
    return parsed.success
      ? ok(parsed.data)
      : err(domainError.validation({ message: 'Invalid ViewDeleted projection payload' }));
  },
  route: (event) => ({
    transactionScope: 'meta',
    baseId: event.baseId.toString(),
    tableId: event.tableId.toString(),
    streamKey: event.viewId.toString(),
  }),
};
