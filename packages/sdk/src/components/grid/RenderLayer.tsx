import type { FC } from 'react';
import { useRef, useEffect, useMemo } from 'react';
import type { IVisibleRegion } from './hooks';
import type { IInteractionLayerProps } from './InteractionLayer';
import {
  type ICellItem,
  type IPosition,
  type IDragState,
  type IMouseState,
  type IColumnResizeState,
  type ICellPosition,
  type IActiveCellBound,
  type IColumnFreezeState,
  RegionType,
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
  activeCellBound: IActiveCellBound | null;
  dragState: IDragState;
  mouseState: IMouseState;
  columnFreezeState: IColumnFreezeState;
  selection: CombinedSelection;
  isSelecting: boolean;
  isInteracting?: boolean;
  forceRenderFlag: string;
  hoverCellPosition: ICellPosition | null;
  hoveredColumnResizeIndex: number;
  columnResizeState: IColumnResizeState;
  isColumnFreezable?: boolean;
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
    activeCellBound,
    collaborators,
    dragState,
    scrollState,
    columnFreezeState,
    hoverCellPosition,
    mouseState: originMouseState,
    selection,
    isSelecting,
    isInteracting: _isInteracting,
    coordInstance,
    forceRenderFlag,
    getCellContent,
    rowIndexVisible,
    columnStatistics,
    columnResizeState,
    rowCounterVisible,
    hoveredColumnResizeIndex,
    isColumnFreezable,
    isRowAppendEnable,
    isColumnResizable,
    isColumnAppendEnable,
    isColumnHeaderMenuVisible,
    isMultiSelectionEnable,
  } = props;
  const { containerWidth } = coordInstance;
  const { x, y, columnIndex, rowIndex, type, isOutOfBounds } = originMouseState;
  const isInteracting = _isInteracting || type === RegionType.ColumnFreezeHandler;

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
    if (!isInteracting) return null;
    return { x, y };
  }, [x, y, isInteracting]);

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
      activeCellBound,
      collaborators,
      dragState,
      scrollState,
      columnFreezeState,
      hoverCellPosition,
      mouseState: mousePosition ? { ...mouseState, ...mousePosition } : mouseState,
      selection,
      isSelecting,
      isInteracting,
      coordInstance,
      forceRenderFlag,
      getCellContent,
      rowIndexVisible,
      columnStatistics,
      columnResizeState,
      rowCounterVisible,
      hoveredColumnResizeIndex,
      isColumnFreezable,
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
    activeCellBound,
    collaborators,
    dragState,
    mouseState,
    scrollState,
    columnFreezeState,
    mousePosition,
    selection,
    isSelecting,
    isInteracting,
    coordInstance,
    forceRenderFlag,
    getCellContent,
    rowIndexVisible,
    columnStatistics,
    columnResizeState,
    rowCounterVisible,
    hoverCellPosition,
    hoveredColumnResizeIndex,
    isColumnFreezable,
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
