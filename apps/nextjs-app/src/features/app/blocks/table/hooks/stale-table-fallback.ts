// Tables this window deleted itself, kept briefly. The deleting client must
// not be "recovered": its own success callback navigates to the adjacent
// node, and until that (possibly non-shallow, gSSP-bound) navigation lands
// the URL still anchors the deleted table — so the asPath check alone cannot
// tell the actor from a bystander, and the actor would sometimes get the
// "your table was deleted" toast plus a competing redirect. Module scope on
// purpose: the delete dialogs and the recovery hooks are separate component
// trees. The TTL only bounds memory; a mark that outlives its navigation is
// harmless because recovery is moot once the URL moved on.
const locallyDeletedTables = new Map<string, number>(); // tableId -> expiry epoch ms
const LOCALLY_DELETED_TTL_MS = 30_000;

/** Call before issuing a table deletion from this window. */
export const markTableDeletedLocally = (tableId: string) => {
  locallyDeletedTables.set(tableId, Date.now() + LOCALLY_DELETED_TTL_MS);
};

/**
 * Call when that deletion request failed — the table still exists, so a
 * later deletion by someone else must recover this window normally.
 */
export const unmarkTableDeletedLocally = (tableId: string) => {
  locallyDeletedTables.delete(tableId);
};

export const wasTableDeletedLocally = (tableId: string) => {
  const expiresAt = locallyDeletedTables.get(tableId);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    locallyDeletedTables.delete(tableId);
    return false;
  }
  return true;
};

/**
 * How long the local-deletion mark still suppresses recovery. A suppressed
 * recovery trigger may be the only one the deletion produces (the list only
 * empties once), so the caller schedules a retry for when the mark lapses
 * instead of dropping the trigger — if by then the table was restored and
 * deleted again by someone else, that retry is what recovers this window.
 */
export const locallyDeletedRemainingMs = (tableId: string) => {
  const expiresAt = locallyDeletedTables.get(tableId);
  if (expiresAt === undefined) return 0;
  return Math.max(0, expiresAt - Date.now());
};

/**
 * Whether the anchored table is missing from the subscribed table list — i.e.
 * the anchor is *suspected* stale. This is only a suspicion: the list can lag
 * reality in both directions (a just-created table has not arrived yet, a
 * just-deleted one has not left yet), so the caller must confirm against the
 * HTTP table list before acting on it.
 */
export const isStaleTableAnchor = (props: {
  tables: { id: string; baseId?: string }[];
  baseId?: string;
  tableId?: string;
}): boolean => {
  const { tables, baseId, tableId } = props;
  if (!baseId || !tableId || tables.length === 0) return false;
  // Instances seeded from SSR data carry no baseId (it is stamped from the
  // sharedb doc's collection, see createTableInstance), and mid base-switch
  // the provider can briefly still hold the previous base's instances —
  // never judge the anchor against either.
  if (tables.some((table) => table.baseId !== baseId)) return false;
  return !tables.some((table) => table.id === tableId);
};
