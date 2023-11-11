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
  ICellPosition,
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
    | 'rowIndexVisible'
    | 'rowCounterVisible'
    | 'isMultiSelectionEnable'
    | 'collaborators'
  > {
  isEditing?: boolean;
  visibleRegion: IVisibleRegion;
  activeCell: ICellItem | null;
  dragState: IDragState;
  mouseState: IMouseState;
  selection: CombinedSelection;
  isSelecting: boolean;
  forceRenderFlag: string;
  hoverCellPosition: ICellPosition | null;
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
    collaborators,
    dragState,
    scrollState,
    hoverCellPosition,
    mouseState: originMouseState,
    selection,
    isSelecting,
    coordInstance,
    forceRenderFlag,
    getCellContent,
    rowIndexVisible,
    columnStatistics,
    columnResizeState,
    rowCounterVisible,
    hoveredColumnResizeIndex,
    isRowAppendEnable,
    isColumnResizable,
    isColumnAppendEnable,
    isColumnHeaderMenuVisible,
    isMultiSelectionEnable,
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
      collaborators,
      dragState,
      scrollState,
      hoverCellPosition,
      mouseState: mousePosition ? { ...mouseState, ...mousePosition } : mouseState,
      selection,
      isSelecting,
      coordInstance,
      forceRenderFlag,
      getCellContent,
      rowIndexVisible,
      columnStatistics,
      columnResizeState,
      rowCounterVisible,
      hoveredColumnResizeIndex,
      isRowAppendEnable,
      isColumnResizable,
      isColumnAppendEnable,
      isColumnHeaderMenuVisible,
      isMultiSelectionEnable,
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
    collaborators,
    dragState,
    scrollState,
    mouseState,
    mousePosition,
    selection,
    isSelecting,
    coordInstance,
    forceRenderFlag,
    getCellContent,
    rowIndexVisible,
    columnStatistics,
    columnResizeState,
    rowCounterVisible,
    hoverCellPosition,
    hoveredColumnResizeIndex,
    isRowAppendEnable,
    isColumnResizable,
    isColumnAppendEnable,
    isColumnHeaderMenuVisible,
    isMultiSelectionEnable,
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
