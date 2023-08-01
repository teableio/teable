import type { FC } from 'react';
import { useRef, useEffect } from 'react';
import type { IVisibleRegion } from './hooks';
import type { IInteractionLayerProps } from './InteractionLayer';
import type { ICellItem, IColumnResizeState, IDragState, IMouseState } from './interface';
import type { CombinedSelection } from './managers';
import { drawGrid } from './renderers';

export interface IRenderLayerProps
  extends Pick<
    IInteractionLayerProps,
    | 'theme'
    | 'columns'
    | 'rowControls'
    | 'imageManager'
    | 'spriteManager'
    | 'scrollState'
    | 'getCellContent'
    | 'coordInstance'
  > {
  isEditing: boolean;
  visibleRegion: IVisibleRegion;
  activeCell: ICellItem | null;
  dragState: IDragState;
  mouseState: IMouseState;
  selection: CombinedSelection;
  isSelecting: boolean;
  columnResizeState: IColumnResizeState;
  isRowAppendEnable?: boolean;
  isColumnResizable?: boolean;
  isColumnAppendEnable?: boolean;
  isColumnHeaderMenuVisible?: boolean;
}

export const RenderLayer: FC<React.PropsWithChildren<IRenderLayerProps>> = (props) => {
  const { coordInstance } = props;
  const { containerWidth, containerHeight } = coordInstance;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    drawGrid(canvas, props);
  }, [props]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none"
      style={{
        width: containerWidth,
        height: containerHeight,
      }}
    />
  );
};
