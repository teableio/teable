import type { FC } from 'react';
import { useRef, useEffect, useMemo } from 'react';
import type { IVisibleRegion } from './hooks';
import type { IInteractionLayerProps } from './InteractionLayer';
import { RegionType } from './interface';
import type {
  ILinearRow,
  ICellItem,
  IPosition,
  IDragState,
  IMouseState,
  IColumnResizeState,
  ICellPosition,
  IActiveCellBound,
  IColumnFreezeState,
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
    | 'commentCountMap'
    | 'rowControls'
    | 'imageManager'
    | 'spriteManager'
    | 'scrollState'
    | 'coordInstance'
    | 'columnStatistics'
    | 'groupCollection'
    | 'rowIndexVisible'
    | 'searchCursor'
    | 'searchHitIndex'
    | 'collaborators'
    | 'columnHeaderVisible'
    | 'isMultiSelectionEnable'
    | 'getCellContent'
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
  real2RowIndex: (index: number) => number;
  getLinearRow: (index: number) => ILinearRow;
}

export const RenderLayer: FC<React.PropsWithChildren<IRenderLayerProps>> = (props) => {
  const {
    theme,
    width,
    height,
    columns,
    commentCountMap,
    isEditing,
    rowControls,
    visibleRegion,
    imageManager,
    spriteManager,
    activeCell,
    activeCellBound,
    collaborators,
    searchCursor,
    searchHitIndex,
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
    groupCollection,
    rowIndexVisible,
    columnStatistics,
    columnResizeState,
    columnHeaderVisible,
    hoveredColumnResizeIndex,
    isColumnFreezable,
    isRowAppendEnable,
    isColumnResizable,
    isColumnAppendEnable,
    isMultiSelectionEnable,
    isColumnHeaderMenuVisible,
    getCellContent,
    real2RowIndex,
    getLinearRow,
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
      commentCountMap,
      isEditing,
      rowControls,
      visibleRegion,
      imageManager,
      spriteManager,
      activeCell,
      activeCellBound,
      collaborators,
      searchCursor,
      searchHitIndex,
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
      groupCollection,
      rowIndexVisible,
      columnStatistics,
      columnResizeState,
      columnHeaderVisible,
      hoveredColumnResizeIndex,
      isColumnFreezable,
      isRowAppendEnable,
      isColumnResizable,
      isColumnAppendEnable,
      isColumnHeaderMenuVisible,
      isMultiSelectionEnable,
      getCellContent,
      real2RowIndex,
      getLinearRow,
    };
    lastPropsRef.current = props;
    drawGrid(mainCanvas, cacheCanvas, props, lastProps);
  }, [
    theme,
    width,
    height,
    columns,
    commentCountMap,
    isEditing,
    rowControls,
    visibleRegion,
    imageManager,
    spriteManager,
    activeCell,
    activeCellBound,
    collaborators,
    searchCursor,
    searchHitIndex,
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
    groupCollection,
    rowIndexVisible,
    columnStatistics,
    columnResizeState,
    columnHeaderVisible,
    hoverCellPosition,
    hoveredColumnResizeIndex,
    isColumnFreezable,
    isRowAppendEnable,
    isColumnResizable,
    isColumnAppendEnable,
    isColumnHeaderMenuVisible,
    isMultiSelectionEnable,
    cacheCanvas,
    getCellContent,
    real2RowIndex,
    getLinearRow,
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
