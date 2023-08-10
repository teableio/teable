import type { FC } from 'react';
import { useRef, useEffect, useMemo } from 'react';
import type { IVisibleRegion } from './hooks';
import type { IInteractionLayerProps } from './InteractionLayer';
import type {
  ICellItem,
  IPosition,
  IDragState,
  IMouseState,
  IColumnResizeState,
} from './interface';
import type { CombinedSelection } from './managers';
import { drawGrid } from './renderers';

export interface IRenderLayerProps
  extends Pick<
    IInteractionLayerProps,
    | 'theme'
    | 'width'
    | 'height'
    | 'columns'
    | 'rowControls'
    | 'imageManager'
    | 'spriteManager'
    | 'scrollState'
    | 'getCellContent'
    | 'coordInstance'
    | 'columnStatistics'
  > {
  isEditing: boolean;
  visibleRegion: IVisibleRegion;
  activeCell: ICellItem | null;
  dragState: IDragState;
  mouseState: IMouseState;
  selection: CombinedSelection;
  isSelecting: boolean;
  hoveredColumnResizeIndex: number;
  columnResizeState: IColumnResizeState;
  isRowAppendEnable?: boolean;
  isColumnResizable?: boolean;
  isColumnAppendEnable?: boolean;
  isColumnHeaderMenuVisible?: boolean;
}

export const RenderLayer: FC<React.PropsWithChildren<IRenderLayerProps>> = (props) => {
  const {
    theme,
    width,
    height,
    columns,
    isEditing,
    rowControls,
    visibleRegion,
    imageManager,
    spriteManager,
    activeCell,
    dragState,
    scrollState,
    mouseState: originMouseState,
    selection,
    isSelecting,
    coordInstance,
    getCellContent,
    columnStatistics,
    columnResizeState,
    hoveredColumnResizeIndex,
    isRowAppendEnable,
    isColumnResizable,
    isColumnAppendEnable,
    isColumnHeaderMenuVisible,
  } = props;
  const { isDragging } = dragState;
  const { containerWidth } = coordInstance;
  const { columnIndex: resizingColumnIndex } = columnResizeState;
  const { x, y, columnIndex, rowIndex, type, isOutOfBounds } = originMouseState;
  const isColumnResizing = resizingColumnIndex > -1;
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPropsRef = useRef<IRenderLayerProps>();

  const cacheCanvas = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.style.opacity = '0';
    canvas.style.position = 'fixed';
    return canvas;
  }, []);

  const mouseState: IMouseState = useMemo(() => {
    return {
      type,
      rowIndex,
      columnIndex,
      isOutOfBounds,
      x: 0,
      y: 0,
      hoverCellX: 0,
      hoverCellY: 0,
    };
  }, [columnIndex, rowIndex, type, isOutOfBounds]);

  const mousePosition: IPosition | null = useMemo(() => {
    if (!isDragging && !isColumnResizing) return null;
    return { x, y };
  }, [x, y, isDragging, isColumnResizing]);

  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    if (mainCanvas == null) return;
    const lastProps = lastPropsRef.current;
    const props = {
      theme,
      width,
      height,
      columns,
      isEditing,
      rowControls,
      visibleRegion,
      imageManager,
      spriteManager,
      activeCell,
      dragState,
      scrollState,
      mouseState: mousePosition ? { ...mouseState, ...mousePosition } : mouseState,
      selection,
      isSelecting,
      coordInstance,
      getCellContent,
      columnStatistics,
      columnResizeState,
      hoveredColumnResizeIndex,
      isRowAppendEnable,
      isColumnResizable,
      isColumnAppendEnable,
      isColumnHeaderMenuVisible,
    };
    lastPropsRef.current = props;
    drawGrid(mainCanvas, cacheCanvas, props, lastProps);
  }, [
    theme,
    width,
    height,
    columns,
    isEditing,
    rowControls,
    visibleRegion,
    imageManager,
    spriteManager,
    activeCell,
    dragState,
    scrollState,
    mouseState,
    mousePosition,
    selection,
    isSelecting,
    coordInstance,
    getCellContent,
    columnStatistics,
    columnResizeState,
    hoveredColumnResizeIndex,
    isRowAppendEnable,
    isColumnResizable,
    isColumnAppendEnable,
    isColumnHeaderMenuVisible,
    cacheCanvas,
  ]);

  return (
    <canvas
      ref={mainCanvasRef}
      className="pointer-events-none"
      style={{
        width: containerWidth,
        height,
        backgroundColor: theme.cellBg,
      }}
    />
  );
};
