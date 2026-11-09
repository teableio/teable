import type { IViewVo } from '@teable/core';
import { describe, expect, it } from 'vitest';
import {
  omitViewShareConfigFromOp,
  presentViewSnapshotsShareConfig,
  presentViewsShareConfig,
  touchesViewShareConfig,
} from './view-share-config';

const sharedView = {
  id: 'viwShared',
  name: 'Shared',
  enableShare: true,
  shareId: 'shrSecretLink',
  shareMeta: { allowCopy: true, password: 'secret-pass' },
} as unknown as IViewVo;

describe('presentViewsShareConfig', () => {
  it('keeps the link and settings for a member who manages shares', () => {
    expect(presentViewsShareConfig([sharedView], ['view|read', 'view|share'])).toEqual([
      sharedView,
    ]);
  });

  it('leaves anyone else only that the view is shared', () => {
    const [view] = presentViewsShareConfig([sharedView], ['view|read', 'view|update']);
    expect(view).toEqual({ id: 'viwShared', name: 'Shared', enableShare: true });
  });

  it('does the same inside ShareDB snapshots', () => {
    const [snapshot] = presentViewSnapshotsShareConfig(
      [{ id: 'viwShared', v: 3, type: 'json0', data: sharedView }],
      ['view|read']
    );
    expect(snapshot.v).toBe(3);
    expect(snapshot.data).toEqual({ id: 'viwShared', name: 'Shared', enableShare: true });
  });
});

describe('omitViewShareConfigFromOp', () => {
  const op = {
    v: 7,
    op: [
      { p: ['shareId'], oi: 'shrNewLink', od: 'shrOldLink' },
      { p: ['shareMeta'], oi: { password: 'new-pass', allowCopy: true }, od: { allowCopy: true } },
      { p: ['shareMeta', 'allowEdit'], oi: true },
      { p: ['enableShare'], oi: true },
      { p: ['name'], oi: 'Renamed', od: 'Shared' },
    ],
  };

  it('drops the link and settings changes, and leaves the rest of the op', () => {
    expect(touchesViewShareConfig(op)).toBe(true);
    expect(omitViewShareConfigFromOp(op)).toEqual({
      v: 7,
      op: [
        { p: ['enableShare'], oi: true },
        { p: ['name'], oi: 'Renamed', od: 'Shared' },
      ],
    });
  });

  it('never edits the op it is given, which ShareDB shares between subscribers', () => {
    const before = JSON.stringify(op);
    omitViewShareConfigFromOp(op);
    expect(JSON.stringify(op)).toBe(before);
  });

  it('strips a created view the same way', () => {
    const created = omitViewShareConfigFromOp({ create: { type: 'json0', data: sharedView } });
    expect(created.create).toEqual({
      type: 'json0',
      data: { id: 'viwShared', name: 'Shared', enableShare: true },
    });
  });

  it('leaves ops that do not touch the share alone', () => {
    expect(touchesViewShareConfig({ op: [{ p: ['name'], oi: 'Renamed' }] })).toBe(false);
  });
});
