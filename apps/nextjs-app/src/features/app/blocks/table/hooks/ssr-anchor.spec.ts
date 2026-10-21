import { describe, expect, it } from 'vitest';
import {
  captureAnchorCollapseState,
  createSsrAnchorState,
  updateSsrAnchorState,
} from './ssr-anchor';

describe('SSR anchor freshness', () => {
  it('keeps the page-load snapshot authoritative while the anchor holds', () => {
    const state = createSsrAnchorState('tblA', 'viw1');

    expect(updateSsrAnchorState(state, 'tblA', 'viw1').fresh).toBe(true);
  });

  it('retires the snapshot on a table switch', () => {
    const state = createSsrAnchorState('tblA', 'viw1');
    const next = updateSsrAnchorState(state, 'tblB', 'viw9');

    expect(next).toEqual({ tableId: 'tblB', viewId: 'viw9', fresh: false });
  });

  it('does not resurrect the snapshot when the anchor returns', () => {
    const state = createSsrAnchorState('tblA', 'viw1');
    const left = updateSsrAnchorState(state, 'tblA', 'viw2');
    // the user comes back to the view the document was rendered for; the
    // snapshot still describes the page load, not the live data
    const returned = updateSsrAnchorState(left, 'tblA', 'viw1');

    expect(returned.fresh).toBe(false);
  });
});

describe('seed collapse state', () => {
  it('captures the collapse state the user arrived with', () => {
    const captured = captureAnchorCollapseState({ anchor: '' }, 'tblA-viw1', ['grpCollapsed']);

    expect(captured).toEqual({ anchor: 'tblA-viw1', ids: ['grpCollapsed'] });
  });

  it('ignores collapse toggles after the anchor settled', () => {
    const captured = captureAnchorCollapseState({ anchor: '' }, 'tblA-viw1', ['grpCollapsed']);
    const toggled = captureAnchorCollapseState(captured, 'tblA-viw1', []);

    expect(toggled).toBe(captured);
  });

  it('captures the next anchor collapse state', () => {
    const captured = captureAnchorCollapseState(
      { anchor: 'tblA-viw1', ids: ['grpA'] },
      'tblA-viw2',
      ['grpB']
    );

    expect(captured).toEqual({ anchor: 'tblA-viw2', ids: ['grpB'] });
  });
});
