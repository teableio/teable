import { describe, expect, it } from 'vitest';
import { isStaleViewAnchor } from './stale-view-fallback';

const tableId = 'tblCurrent';
const view = (id: string, viewTableId: string = tableId) => ({ id, tableId: viewTableId });

describe('isStaleViewAnchor', () => {
  it('is false when the anchored view is in the list', () => {
    expect(
      isStaleViewAnchor({ views: [view('viwA'), view('viwB')], tableId, viewId: 'viwB' })
    ).toBe(false);
  });

  it('is true when the anchored view is missing from the list', () => {
    expect(
      isStaleViewAnchor({
        views: [view('viwA'), view('viwB')],
        tableId,
        viewId: 'viwDeleted',
      })
    ).toBe(true);
  });

  it('is false while the list still holds another table’s views (mid table-switch)', () => {
    expect(
      isStaleViewAnchor({
        views: [view('viwA', 'tblPrevious')],
        tableId,
        viewId: 'viwDeleted',
      })
    ).toBe(false);
  });

  it('is false when even one view belongs to another table', () => {
    expect(
      isStaleViewAnchor({
        views: [view('viwA'), view('viwB', 'tblPrevious')],
        tableId,
        viewId: 'viwDeleted',
      })
    ).toBe(false);
  });

  it('is false when the list is empty (no-view empty state owns this case)', () => {
    expect(isStaleViewAnchor({ views: [], tableId, viewId: 'viwDeleted' })).toBe(false);
  });

  it('is false without an anchor', () => {
    expect(isStaleViewAnchor({ views: [view('viwA')], tableId, viewId: undefined })).toBe(false);
    expect(isStaleViewAnchor({ views: [view('viwA')], tableId: undefined, viewId: 'viwA' })).toBe(
      false
    );
  });
});
