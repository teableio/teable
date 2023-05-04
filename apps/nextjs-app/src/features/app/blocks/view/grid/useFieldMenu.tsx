import type { DataEditorRef, Rectangle } from '@glideapps/glide-data-grid';
import type { MutableRefObject, RefObject } from 'react';
import { useMemo } from 'react';

export const useFieldMenuPosition = (
  container: RefObject<HTMLDivElement>,
  editorRef: MutableRefObject<DataEditorRef | null>,
  opt?: { col: number; bounds: Rectangle }
) => {
  const { col, bounds } = opt || {};
  return useMemo(() => {
    if (!bounds || !container.current || !editorRef.current || col == undefined) {
      return {
        x: 0,
        y: 0,
      };
    }

    const { offsetLeft } = container.current;
    const firstCol = editorRef.current.getBounds(0);
    const firstColX = firstCol?.x || 0;
    const otherStartX = firstColX + (firstCol?.width || 0);

    const posX = col > 0 ? (bounds.x > otherStartX ? bounds.x : otherStartX) : firstColX;

    const x = posX - offsetLeft;

    return {
      x: x,
      y: bounds.height,
    };
  }, [bounds, container, editorRef, col]);
};
