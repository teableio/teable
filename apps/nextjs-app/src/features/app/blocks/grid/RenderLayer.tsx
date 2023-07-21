import type { FC } from 'react';
import { useRef, useEffect } from 'react';
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
  extends Omit<IInteractionLayerProps, 'scrollTo' | 'scrollBy' | 'setMouseState'> {
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
}

export const RenderLayer: FC<React.PropsWithChildren<IRenderLayerProps>> = (props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { coordInstance } = props;
  const { containerWidth, containerHeight } = coordInstance;

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
