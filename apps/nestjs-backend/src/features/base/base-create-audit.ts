import type { ICreateBaseVo } from '@teable/openapi';
import { Events } from '../../event-emitter/events';
import type { AuditScope } from '../audit/audit-scope';

type IAuditedBase = ICreateBaseVo & { icon?: string | null };

/**
 * The `base.create` row of a base no controller BASE_CREATE event records: routes that answer over
 * SSE (import / duplicate streams, Airtable and Google Sheets imports) and the shared-base copy.
 *
 * Emitted inside the caller's audit operation, so the row carries its rootAction (`base.import`,
 * `base.duplicate`, `share.base.copy`, …) and operation_id; the `base` snapshot has the shape of
 * the event-driven row. Never throws: the base exists whether or not its row is written.
 */
export const auditBaseCreated = async (
  audit: AuditScope,
  base: IAuditedBase,
  params?: Record<string, unknown>
): Promise<void> => {
  try {
    await audit.emitAtomic({
      action: Events.BASE_CREATE,
      resourceId: base.id,
      params: { baseId: base.id, spaceId: base.spaceId, ...params },
      payload: {
        base: {
          id: base.id,
          name: base.name,
          spaceId: base.spaceId,
          ...(base.icon ? { icon: base.icon } : {}),
        },
      },
    });
  } catch {
    // emitAtomic logs its own failures.
  }
};
