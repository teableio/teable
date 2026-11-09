import type { IOtOperation, IViewVo } from '@teable/core';

/**
 * A view's share link (`shareId`) opens the view to anyone who holds it, past the caller's own
 * permissions and the authority matrix, and its share settings (`shareMeta`: password, edit and
 * copy rights, ...) say how. Only a member who manages the view's share (`view|share`) reads
 * them; anyone else who reads the view learns whether it is shared (`enableShare`), nothing more.
 */
export const canReadViewShareConfig = (permissions: readonly string[] | undefined): boolean =>
  Boolean(permissions?.includes('view|share'));

type IViewShareFields = Pick<IViewVo, 'shareId' | 'shareMeta'>;

const isShareConfigPath = (p: IOtOperation['p']) => p[0] === 'shareId' || p[0] === 'shareMeta';

export const omitViewShareConfig = <T extends IViewShareFields>(view: T): T => {
  if (view.shareId === undefined && view.shareMeta === undefined) return view;
  const { shareId: _shareId, shareMeta: _shareMeta, ...rest } = view;
  return rest as T;
};

/** The same for the views a request hands back, by the caller's permissions. */
export const presentViewsShareConfig = <T extends IViewShareFields>(
  views: T[],
  permissions: readonly string[] | undefined
): T[] => (canReadViewShareConfig(permissions) ? views : views.map(omitViewShareConfig));

/** And for ShareDB snapshots of views (`{ id, v, type, data }`). */
export const presentViewSnapshotsShareConfig = <T extends { data?: IViewShareFields }>(
  snapshots: T[],
  permissions: readonly string[] | undefined
): T[] =>
  canReadViewShareConfig(permissions)
    ? snapshots
    : snapshots.map((snapshot) =>
        snapshot.data ? { ...snapshot, data: omitViewShareConfig(snapshot.data) } : snapshot
      );

/** A ShareDB op as middleware sees it: its version, source and the like beside the edits. */
export type IViewShareDbOp = {
  op?: IOtOperation[];
  create?: { type?: string; data?: unknown };
  [key: string]: unknown;
};

/** Whether a ShareDB op on a view document sets or removes its share link or settings. */
export const touchesViewShareConfig = (op: IViewShareDbOp): boolean => {
  if (op.create?.data && typeof op.create.data === 'object') {
    const data = op.create.data as IViewShareFields;
    if (data.shareId !== undefined || data.shareMeta !== undefined) return true;
  }
  return Boolean(op.op?.some(({ p }) => isShareConfigPath(p)));
};

/**
 * The op as a subscriber without `view|share` must receive it: changes to the share link and
 * settings dropped, the rest kept. Their snapshot has neither, so nothing else would apply.
 * Returns new objects; the op ShareDB passes to middleware is a shallow copy shared with other
 * subscribers, so nothing in it is changed in place.
 */
export const omitViewShareConfigFromOp = <T extends IViewShareDbOp>(op: T): T => {
  const next: T = { ...op };
  if (op.create?.data && typeof op.create.data === 'object') {
    next.create = {
      ...op.create,
      data: omitViewShareConfig(op.create.data as IViewShareFields),
    };
  }
  if (op.op) {
    next.op = op.op.filter(({ p }) => !isShareConfigPath(p));
  }
  return next;
};
