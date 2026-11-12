import type { IGridRef } from '@teable/sdk';
import { useGuideSpotlightStore } from '@teable/sdk';
import { act, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideSpotlight } from './GuideSpotlight';

const setup = (tableId = 'tblA') => {
  const gridContainer = document.createElement('div');
  const grid = {
    scrollToItem: vi.fn(),
    getCellBounds: vi.fn(() => ({ x: 100, y: 40, width: 200, height: 32 })),
    getContainer: () => gridContainer,
  };
  const spotlightRef = createRef<{ onScrollHandler: () => void }>();
  const { container } = render(
    <GuideSpotlight
      ref={spotlightRef}
      gridRef={{ current: grid as unknown as IGridRef }}
      tableId={tableId}
      fieldsTableId={tableId}
      columns={[{ id: 'fldPrimary' }, { id: 'fldName' }]}
      hasFirstRecord
    />
  );
  const dot = () => container.querySelector<HTMLElement>('[aria-hidden]');
  return { grid, gridContainer, spotlightRef, dot };
};

const spotlight = (fieldId = 'fldName') =>
  act(() => useGuideSpotlightStore.getState().spotlight({ tableId: 'tblA', fieldId }));

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('GuideSpotlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGuideSpotlightStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scrolls to the first row of the field, centers the dot on it and clears after 6 s', () => {
    const { grid, dot } = setup();
    spotlight();

    advance(200);
    expect(grid.scrollToItem).toHaveBeenCalledWith([1, 0]);
    expect(dot()).toBeNull();

    advance(200);
    expect(grid.getCellBounds).toHaveBeenCalledWith([1, 0]);
    expect(dot()?.style.left).toBe('200px');
    expect(dot()?.style.top).toBe('56px');

    advance(6000);
    expect(dot()).toBeNull();
    expect(useGuideSpotlightStore.getState().request).toBeNull();
  });

  it('silently drops a request for a field the view does not show', () => {
    const { grid } = setup();
    spotlight('fldHidden');

    advance(1000);
    expect(grid.scrollToItem).not.toHaveBeenCalled();
    expect(useGuideSpotlightStore.getState().request).toBeNull();
  });

  it('leaves a request for another table to that table', () => {
    const { grid } = setup('tblB');
    spotlight();

    advance(1000);
    expect(grid.scrollToItem).not.toHaveBeenCalled();
    expect(useGuideSpotlightStore.getState().request).not.toBeNull();
  });

  it('clears when the user presses on the grid', () => {
    const { gridContainer, dot } = setup();
    spotlight();
    advance(400);
    expect(dot()).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(gridContainer);
    });
    expect(dot()).toBeNull();
    expect(useGuideSpotlightStore.getState().request).toBeNull();
  });

  it('ignores its own scroll but clears once the user scrolls the shown dot away', () => {
    const { spotlightRef, dot } = setup();
    spotlight();
    advance(200);
    act(() => spotlightRef.current?.onScrollHandler());
    advance(200);
    expect(dot()).not.toBeNull();

    act(() => spotlightRef.current?.onScrollHandler());
    expect(dot()).toBeNull();
  });
});
