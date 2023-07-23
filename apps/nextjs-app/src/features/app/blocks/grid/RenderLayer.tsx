import type { FC } from 'react';
import { useRef, useLayoutEffect } from 'react';
import type { IInteractionLayerProps } from './InteractionLayer';
import type {
  ICellItem,
  IColumnResizeState,
  IDragState,
  IMouseState,
  ISelectionState,
} from './interface';
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
  startRowIndex: number;
  stopRowIndex: number;
  startColumnIndex: number;
  stopColumnIndex: number;
  activeCell: ICellItem | null;
  dragState: IDragState;
  mouseState: IMouseState;
  selectionState: ISelectionState;
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

  useLayoutEffect(() => {
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
