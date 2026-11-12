import { beforeEach, describe, expect, it } from 'vitest';
import { useGuideSpotlightStore } from './use-guide-spotlight-store';

describe('useGuideSpotlightStore', () => {
  beforeEach(() => {
    useGuideSpotlightStore.getState().clear();
  });

  it('keeps the requested cell until it is cleared', () => {
    useGuideSpotlightStore.getState().spotlight({ tableId: 'tblA', fieldId: 'fldName' });

    expect(useGuideSpotlightStore.getState().request).toMatchObject({
      tableId: 'tblA',
      fieldId: 'fldName',
      requestedAt: expect.any(Number),
    });

    useGuideSpotlightStore.getState().clear();

    expect(useGuideSpotlightStore.getState().request).toBeNull();
  });

  it('makes every call a new request, even for the same cell', () => {
    const { spotlight } = useGuideSpotlightStore.getState();
    spotlight({ tableId: 'tblA', fieldId: 'fldName' });
    const first = useGuideSpotlightStore.getState().request;

    spotlight({ tableId: 'tblA', fieldId: 'fldName' });

    expect(useGuideSpotlightStore.getState().request).not.toBe(first);
  });
});
