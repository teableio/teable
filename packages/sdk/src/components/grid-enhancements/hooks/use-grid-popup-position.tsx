import { useMemo } from 'react';
import { GRID_CONTAINER_ID } from '../../grid/configs';
import type { IRectangle } from '../../grid/interface';

const SAFE_SPACING = 32;

export const useGridPopupPosition = (rect: IRectangle, maxHeight?: number) => {
  const { y, height } = rect;

  return useMemo(() => {
    const gridElement = document.querySelector('#' + GRID_CONTAINER_ID);
    const gridBound = gridElement?.getBoundingClientRect();

    if (gridBound == null) return;

    const screenH = window.innerHeight;
    const { y: gridY } = gridBound;
    const spaceAbove = y;
    const spaceBelow = screenH - gridY - y - height;
    const isAbove = spaceAbove > spaceBelow;
    const finalHeight = Math.min((isAbove ? y : spaceBelow) - SAFE_SPACING, maxHeight ?? Infinity);

    return {
      top: isAbove ? 'unset' : height + 1,
      bottom: isAbove ? height : 'unset',
      maxHeight: finalHeight,
    };
  }, [y, height, maxHeight]);
};
