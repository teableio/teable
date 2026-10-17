import type { Table } from '../Table';
import type { FieldId } from './FieldId';
import type { LastModifiedByField } from './types/LastModifiedByField';
import type { LastModifiedTimeField } from './types/LastModifiedTimeField';

/**
 * The tracking list a modification stamp actually follows.
 *
 * `trackedFieldIds` names the fields whose change advances the stamp. An empty
 * list means "track every field", and so does a list whose entries no longer
 * resolve on the table — a configuration pointing only at deleted fields is
 * indistinguishable from track-all, which is the same rule the update path
 * applies.
 */
export function resolveTrackedFieldIds(
  table: Table,
  field: LastModifiedByField | LastModifiedTimeField
): ReadonlyArray<FieldId> {
  const trackedFieldIds = field.trackedFieldIds();
  if (trackedFieldIds.length === 0) {
    return [];
  }

  const validTracked = trackedFieldIds.filter((tracked) =>
    table.getField((candidate) => candidate.id().equals(tracked)).isOk()
  );

  return validTracked.length === 0 ? [] : validTracked;
}
