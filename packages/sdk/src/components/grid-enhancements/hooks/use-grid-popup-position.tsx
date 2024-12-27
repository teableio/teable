import { useMemo } from 'react';
import type { IEditorProps } from '../../grid/components';
import { GRID_CONTAINER_ATTR } from '../../grid/configs';

const SAFE_SPACING = 32;

export const useGridPopupPosition = (rect: IEditorProps['rect'], maxHeight?: number) => {
  const { y, height, editorId } = rect;

  return useMemo(() => {
    const editorElement = document.querySelector('#' + editorId);
    const gridElement = editorElement?.closest(`[${GRID_CONTAINER_ATTR}]`);
    const gridBound = gridElement?.getBoundingClientRect();

    if (gridBound == null) return;

    const screenH = window.innerHeight;
    const { y: gridY } = gridBound;
    const spaceAbove = Math.max(y, gridY);
    const spaceBelow = screenH - gridY - y - height;
    const isAbove = spaceAbove > spaceBelow;
    const finalHeight = Math.min((isAbove ? y : spaceBelow) - SAFE_SPACING, maxHeight ?? Infinity);

    return {
      top: isAbove ? 'unset' : height + 1,
      bottom: isAbove ? height : 'unset',
      maxHeight: finalHeight,
    };
  }, [editorId, y, height, maxHeight]);
};
