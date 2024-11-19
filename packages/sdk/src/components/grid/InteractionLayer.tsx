/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { isEqual } from 'lodash';
import type { Dispatch, ForwardRefRenderFunction, SetStateAction } from 'react';
import { useState, useRef, forwardRef, useImperativeHandle, useMemo, useLayoutEffect } from 'react';
import { useClickAway, useMouse } from 'react-use';
import type { CellScrollerRef } from './CellScroller';
import { CellScroller } from './CellScroller';
import type { IEditorContainerRef } from './components';
import { EditorContainer } from './components';
import type { IGridTheme } from './configs';

import {
  GRID_DEFAULT,
  DEFAULT_MOUSE_STATE,
  DEFAULT_DRAG_STATE,
  DEFAULT_COLUMN_RESIZE_STATE,
} from './configs';
import type { IGridProps } from './Grid';
import {
  useSelection,
  useAutoScroll,
  useColumnResize,
  useColumnFreeze,
  useEventListener,
} from './hooks';
import { useDrag } from './hooks/useDrag';
import { useVisibleRegion } from './hooks/useVisibleRegion';
import type {
  IActiveCellBound,
  ICellItem,
  ICellPosition,
  ICellRegionWithData,
  IInnerCell,
  ILinearRow,
  IMouseState,
  IRowControlItem,
  IScrollState,
} from './interface';
import {
  RegionType,
  LinearRowType,
  DragRegionType,
  MouseButtonType,
  SelectionRegionType,
  DraggableType,
  SelectableType,
} from './interface';
import type { CoordinateManager, ImageManager, SpriteManager, CombinedSelection } from './managers';
import { CellRegionType, getCellRenderer } from './renderers';
import { RenderLayer } from './RenderLayer';
import type { IRegionData } from './utils';
import { BLANK_REGION_DATA, flatRanges, getRegionData, inRange } from './utils';

const { columnAppendBtnWidth, columnHeadHeight } = GRID_DEFAULT;

export interface IInteractionLayerProps
  extends Omit<
    IGridProps,
    | 'freezeColumnCount'
    | 'rowCount'
    | 'rowHeight'
    | 'style'
    | 'smoothScrollX'
    | 'smoothScrollY'
    | 'onVisibleRegionChanged'
  > {
  theme: IGridTheme;
  width: number;
  height: number;
  forceRenderFlag: string;
  rowControls: IRowControlItem[];
  mouseState: IMouseState;
  scrollState: IScrollState;
  imageManager: ImageManager;
  spriteManager: SpriteManager;
  coordInstance: CoordinateManager;
  activeCell: ICellItem | null;
  activeCellBound: IActiveCellBound | null;
  real2RowIndex: (index: number) => number;
  getLinearRow: (index: number) => ILinearRow;
  setActiveCell: Dispatch<SetStateAction<ICellItem | null>>;
  setMouseState: Dispatch<SetStateAction<IMouseState>>;
  scrollBy: (deltaX: number, deltaY: number) => void;
  scrollToItem: (position: [columnIndex: number, rowIndex: number]) => void;
}

export interface IInteractionLayerRef {
  resetState: () => void;
  setSelection: (selection: CombinedSelection) => void;
}

export const InteractionLayerBase: ForwardRefRenderFunction<
  IInteractionLayerRef,
  IInteractionLayerProps
> = (props, ref) => {
  const {
    theme,
    width,
    height,
    columns,
    commentCountMap,
    draggable,
    selectable,
    rowControls,
    mouseState,
    scrollState,
    imageManager,
    spriteManager,
    coordInstance,
    columnStatistics,
    forceRenderFlag,
    rowIndexVisible,
    groupCollection,
    isMultiSelectionEnable,
    activeCellBound: _activeCellBound,
    columnHeaderVisible,
    collapsedGroupIds,
    collaborators,
    searchCursor,
    searchHitIndex,
    activeCell,
    getLinearRow,
    real2RowIndex,
    setActiveCell,
    setMouseState,
    scrollToItem,
    scrollBy,
    getCellContent,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    onRowExpand,
    onRowOrdered,
    onCellEdited,
    onSelectionChanged,
    onColumnFreeze,
    onColumnAppend,
    onColumnResize,
    onColumnOrdered,
    onContextMenu,
    onItemHovered,
    onItemClick,
    onColumnHeaderClick,
    onColumnHeaderDblClick,
    onColumnHeaderMenuClick,
    onColumnStatisticClick,
    onCollapsedGroupChanged,
    onDragStart: _onDragStart,
  } = props;

  useImperativeHandle(ref, () => ({
    resetState,
    setSelection: (selection: CombinedSelection) => {
      const { type, ranges } = selection;

      switch (type) {
        case SelectionRegionType.Cells: {
          const activeCell = ranges[0];
          setActiveCell(activeCell);
          scrollToItem(activeCell);
          break;
        }
        case SelectionRegionType.Columns: {
          const activeCell = [ranges[0][0], 0] as ICellItem;
          setActiveCell(activeCell);
          scrollToItem(activeCell);
          break;
        }
        default: {
          setActiveCell(null);
          break;
        }
      }
      setSelection(selection);
    },
  }));

  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorContainerRef = useRef<IEditorContainerRef>(null);
  const cellScrollerRef = useRef<CellScrollerRef | null>(null);
  const prevActiveCellRef = useRef<ICellItem | null>(null);
  const hoveredRegionRef = useRef<IRegionData>(BLANK_REGION_DATA);
  const previousHoveredRegionRef = useRef<IRegionData>(BLANK_REGION_DATA);

  const mousePosition = useMouse(stageRef);
  const [cellScrollTop, setCellScrollTop] = useState(0);
  const [hoverCellPosition, setHoverCellPosition] = useState<ICellPosition | null>(null);
  const [cursor, setCursor] = useState('default');
  const [isEditing, setEditing] = useState(false);

  const { containerHeight, freezeColumnCount } = coordInstance;
  const { scrollTop, scrollLeft, isScrolling } = scrollState;
  const { type: regionType } = mouseState;
  const isRowAppendEnable = onRowAppend != null;
  const isColumnFreezable = onColumnFreeze != null;
  const isColumnResizable = onColumnResize != null;
  const isColumnAppendEnable = onColumnAppend != null;
  const isColumnHeaderMenuVisible = onColumnHeaderMenuClick != null;

  const visibleRegion = useVisibleRegion(coordInstance, scrollState, forceRenderFlag);
  const {
    columnResizeState,
    hoveredColumnResizeIndex,
    setHoveredColumnResizeIndex,
    setColumnResizeState,
    onColumnResizeStart,
    onColumnResizeChange,
    onColumnResizeEnd,
  } = useColumnResize(coordInstance, scrollState);
  const {
    selection,
    isSelecting,
    setSelection,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
    onSelectionContextMenu,
  } = useSelection({
    selectable,
    coordInstance,
    isMultiSelectionEnable,
    getLinearRow,
    setActiveCell,
    onSelectionChanged,
  });
  const { dragState, setDragState, onDragStart, onDragChange, onDragEnd } = useDrag(
    coordInstance,
    scrollState,
    selection,
    draggable
  );
  const { columnFreezeState, onColumnFreezeStart, onColumnFreezeMove, onColumnFreezeEnd } =
    useColumnFreeze(coordInstance, scrollState);

  const { isDragging, type: dragType } = dragState;
  const { isFreezing } = columnFreezeState;
  const isResizing = columnResizeState.columnIndex > -1;
  const { isCellSelection, ranges: selectionRanges } = selection;
  const isInteracting = isSelecting || isDragging || isResizing || isFreezing;
  const [activeColumnIndex, activeRowIndex] = activeCell ?? [];

  const getPosition = () => {
    const x = mousePosition.elX;
    const y = mousePosition.elY;
    const { freezeRegionWidth, totalWidth, rowInitSize, columnInitSize, columnCount } =
      coordInstance;
    const rowIndex =
      y < 0 ? -Infinity : y <= rowInitSize ? -1 : coordInstance.getRowStartIndex(scrollTop + y);
    const columnIndex =
      x < 0
        ? -Infinity
        : scrollLeft + x > totalWidth && scrollLeft + x < totalWidth + columnAppendBtnWidth
          ? -2
          : x <= freezeRegionWidth
            ? x <= columnInitSize
              ? -1
              : coordInstance.getColumnStartIndex(x)
            : coordInstance.getColumnStartIndex(scrollLeft + x);

    return { x, y, rowIndex, columnIndex: Math.min(columnIndex, columnCount - 1) };
  };

  const getHoverCellPosition = (mouseState: IMouseState) => {
    const { rowIndex, columnIndex, x, y } = mouseState;
    const { realIndex, type } = getLinearRow(rowIndex);
    const isCellRange = columnIndex > -1 && type === LinearRowType.Row;

    if (isCellRange) {
      const cell = getCellContent([columnIndex, realIndex]);
      const cellRenderer = getCellRenderer(cell.type);

      if (
        cellRenderer.needsHoverPosition ||
        (cellRenderer.needsHoverPositionWhenActive &&
          activeCell &&
          isEqual(activeCell, [columnIndex, realIndex]))
      ) {
        const offsetX = coordInstance.getColumnOffset(columnIndex);
        return [
          columnIndex < freezeColumnCount ? x - offsetX : x - offsetX + scrollLeft,
          y - coordInstance.getRowOffset(rowIndex) + scrollTop,
        ] as ICellPosition;
      }
    }
    return null;
  };

  const { onAutoScroll, onAutoScrollStop } = useAutoScroll({
    coordInstance,
    isSelecting,
    isDragging,
    dragType,
    scrollBy,
  });

  const activeCellBound = useMemo(() => {
    if (_activeCellBound == null) return null;
    return {
      ..._activeCellBound,
      scrollTop: _activeCellBound.scrollEnable ? cellScrollTop : 0,
    };
  }, [_activeCellBound, cellScrollTop]);

  const getMouseState = () => {
    const position = getPosition();
    const { x, y } = position;
    const { totalHeight, totalWidth } = coordInstance;
    const isOutOfBounds =
      scrollLeft + x > totalWidth + columnAppendBtnWidth ||
      (scrollTop + y > totalHeight && !inRange(y, containerHeight, height));
    const regionData = getRegionData({
      position,
      dragState,
      selection,
      isSelecting,
      columnResizeState,
      columnStatistics,
      coordInstance,
      scrollState,
      rowControls,
      isFreezing,
      isOutOfBounds,
      isColumnResizable,
      isColumnAppendEnable,
      isMultiSelectionEnable,
      isColumnHeaderMenuVisible,
      isColumnFreezable,
      activeCellBound,
      activeCell,
      columns,
      height,
      theme,
      getLinearRow,
      real2RowIndex,
    });

    hoveredRegionRef.current = regionData;
    const { x: _x, y: _y, width: _w, height: _h, ...rest } = regionData;

    return {
      ...position,
      isOutOfBounds,
      ...rest,
    };
  };

  const setCursorStyle = (regionType: RegionType) => {
    if (isScrolling) return;
    if (isFreezing) return setCursor('grab');
    if (isDragging) return setCursor('grabbing');

    switch (regionType) {
      case RegionType.AppendRow: {
        if (activeCell != null) return;
        return setCursor('pointer');
      }
      case RegionType.AppendColumn:
      case RegionType.GroupStatistic:
      case RegionType.ColumnStatistic:
      case RegionType.ColumnHeaderMenu:
      case RegionType.ColumnDescription:
      case RegionType.ColumnPrimaryIcon:
      case RegionType.RowGroupHeader:
      case RegionType.RowHeaderExpandHandler:
        return setCursor('pointer');
      case RegionType.ColumnFreezeHandler:
        return setCursor('grab');
      case RegionType.AllCheckbox:
      case RegionType.RowHeaderCheckbox: {
        if (
          [SelectableType.None, SelectableType.Column, SelectableType.Cell].includes(
            selectable as SelectableType
          )
        ) {
          return setCursor('not-allowed');
        }
        return setCursor('pointer');
      }
      case RegionType.RowHeaderDragHandler: {
        if (draggable === DraggableType.Column || draggable === DraggableType.None) {
          return setCursor('not-allowed');
        }
        return setCursor('grabbing');
      }
      case RegionType.ColumnResizeHandler:
        return setCursor('ew-resize');
      case RegionType.FillHandler:
        return setCursor('crosshair');
      default:
        setCursor('default');
    }
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onClick = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const mouseState = getMouseState();
    onSelectionClick(event, mouseState);
    const { type, rowIndex: hoverRowIndex, columnIndex } = mouseState;
    if (regionType !== type) return;

    const { realIndex: rowIndex } = getLinearRow(hoverRowIndex);

    switch (type) {
      case RegionType.AppendRow: {
        if (activeCell != null) {
          setSelection(selection.reset());
          return setActiveCell(null);
        }
        const linearRow = getLinearRow(hoverRowIndex - 1);
        onRowAppend?.(linearRow.realIndex);
        return;
      }
      case RegionType.AppendColumn:
        return onColumnAppend?.();
      case RegionType.RowHeaderExpandHandler:
        return onRowExpand?.(rowIndex);
      case RegionType.ColumnHeader:
        return onColumnHeaderClick?.(columnIndex, {
          x: coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft),
          y: 0,
          width: coordInstance.getColumnWidth(columnIndex),
          height: columnHeadHeight,
        });
      case RegionType.ColumnHeaderMenu:
        return onColumnHeaderMenuClick?.(columnIndex, {
          x: coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft),
          y: 0,
          width: coordInstance.getColumnWidth(columnIndex),
          height: columnHeadHeight,
        });
      case RegionType.GroupStatistic:
      case RegionType.ColumnStatistic: {
        const { x, y, width, height } = hoveredRegionRef.current;
        return onColumnStatisticClick?.(columnIndex, {
          x,
          y,
          width,
          height,
        });
      }
      case RegionType.Cell:
      case RegionType.ActiveCell: {
        const cell = getCellContent([columnIndex, rowIndex]) as IInnerCell;
        const cellRenderer = getCellRenderer(cell.type);
        const onCellClick = cellRenderer.onClick;
        const isActive =
          isEqual(prevActiveCellRef.current, activeCell) &&
          isEqual(activeCell, [columnIndex, rowIndex]);

        if (onCellClick && hoverCellPosition) {
          onCellClick(
            cell as never,
            {
              width: coordInstance.getColumnWidth(columnIndex),
              height: coordInstance.getRowHeight(hoverRowIndex),
              theme,
              hoverCellPosition,
              activeCellBound,
              isActive,
            },
            (cellRegion: ICellRegionWithData) => {
              const { type, data } = cellRegion;

              if (type === CellRegionType.Update) {
                return onCellEdited?.([columnIndex, rowIndex], {
                  ...cell,
                  data,
                } as IInnerCell);
              }

              if (type === CellRegionType.ToggleEditing) {
                return setEditing(true);
              }
            }
          );
        }
        return;
      }
      case RegionType.RowGroupHeader: {
        const { rowIndex } = mouseState;
        const linearRow = getLinearRow(rowIndex);
        if (linearRow.type !== LinearRowType.Group) return;
        const { id } = linearRow;

        if (collapsedGroupIds == null) {
          return onCollapsedGroupChanged?.(new Set([id]));
        }

        if (collapsedGroupIds.has(id)) {
          const newCollapsedGroupIds = new Set(collapsedGroupIds);
          newCollapsedGroupIds.delete(id);
          return onCollapsedGroupChanged?.(newCollapsedGroupIds);
        }
        return onCollapsedGroupChanged?.(new Set([...collapsedGroupIds, id]));
      }
    }

    const { type: clickRegionType, ...rest } = hoveredRegionRef.current;
    onItemClick?.(clickRegionType, rest, [columnIndex, rowIndex]);
  };

  const onDblClick = () => {
    const mouseState = getMouseState();
    const { type, rowIndex, columnIndex } = mouseState;
    const { realIndex } = getLinearRow(rowIndex);
    if (
      [RegionType.Cell, RegionType.ActiveCell].includes(type) &&
      isEqual(selectionRanges[0], [columnIndex, realIndex])
    ) {
      const cell = getCellContent([columnIndex, realIndex]) as IInnerCell;
      if (cell.readonly) return;
      editorContainerRef.current?.focus?.();
      return setEditing(true);
    }
    if (
      type === RegionType.ColumnHeader &&
      isEqual(selectionRanges[0], [columnIndex, columnIndex])
    ) {
      return onColumnHeaderDblClick?.(columnIndex, {
        x: coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft),
        y: 0,
        width: coordInstance.getColumnWidth(columnIndex),
        height: columnHeadHeight,
      });
    }
  };

  const onSmartClick = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const eventDetail = event.detail;

    if (eventDetail === 1) {
      onClick(event);
    }

    if (eventDetail === 2) {
      onDblClick();
    }
  };

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.preventDefault();
    if (event.button === MouseButtonType.Right) return;
    const mouseState = getMouseState();
    setMouseState(mouseState);
    const { rowIndex: hoverRowIndex, columnIndex, type } = mouseState;
    const { realIndex: rowIndex } = getLinearRow(hoverRowIndex);
    if (
      !(
        isCellSelection &&
        isEqual(selectionRanges[0], [columnIndex, rowIndex]) &&
        type === RegionType.Cell
      )
    ) {
      setEditing(false);
      editorContainerRef.current?.saveValue?.();
    }
    onDragStart(mouseState, (type, ranges) => {
      if (type === DragRegionType.Columns) {
        _onDragStart?.(type, flatRanges(ranges));
      }
      if (type === DragRegionType.Rows) {
        const originRealIndexs = flatRanges(ranges).map((index) => getLinearRow(index).realIndex);
        _onDragStart?.(type, originRealIndexs);
      }
    });
    onColumnFreezeStart(mouseState);
    prevActiveCellRef.current = activeCell;
    onSelectionStart(event, mouseState);
    isColumnResizable && onColumnResizeStart(mouseState);
  };

  const onCellPosition = (mouseState: IMouseState) => {
    const { columnIndex, rowIndex, type } = mouseState;
    const { realIndex } = getLinearRow(rowIndex);
    const cell = getCellContent([columnIndex, realIndex]);
    const cellRenderer = getCellRenderer(cell.type);
    const { needsHover, needsHoverPosition, needsHoverWhenActive, needsHoverPositionWhenActive } =
      cellRenderer;
    const isActive = type === RegionType.ActiveCell;
    if ((needsHoverPosition || (needsHoverPositionWhenActive && isActive)) && hoverCellPosition) {
      const { type } =
        cellRenderer.checkRegion?.(cell as never, {
          width: coordInstance.getColumnWidth(columnIndex),
          height: coordInstance.getRowHeight(rowIndex),
          theme,
          isActive,
          activeCellBound,
          hoverCellPosition,
        }) ?? {};
      return type !== CellRegionType.Blank ? setCursor('pointer') : undefined;
    }
    if (needsHover || (needsHoverWhenActive && isActive)) {
      setCursor('pointer');
    }
  };

  const onMouseMove = () => {
    const mouseState = getMouseState();
    const hoverCellPosition = getHoverCellPosition(mouseState);
    setHoverCellPosition(() => hoverCellPosition);
    setMouseState(() => mouseState);
    setCursorStyle(mouseState.type);
    onCellPosition(mouseState);
    onAutoScroll(mouseState);
    onSelectionChange(mouseState);
    onColumnResizeChange(mouseState, (newWidth, columnIndex) => {
      onColumnResize?.(columns[columnIndex], newWidth, columnIndex);
    });
    onDragChange(mouseState);
    onColumnFreezeMove(mouseState);
    if (!isInteracting && !isEqual(hoveredRegionRef.current, previousHoveredRegionRef.current)) {
      const { type, ...rest } = hoveredRegionRef.current;
      const { columnIndex, rowIndex } = mouseState;
      onItemHovered?.(type, rest, [columnIndex, getLinearRow(rowIndex).realIndex]);
    }
    previousHoveredRegionRef.current = { ...hoveredRegionRef.current };
  };

  const onMouseUp = () => {
    const mouseState = getMouseState();
    setMouseState(mouseState);
    onAutoScrollStop();
    onDragEnd(mouseState, (ranges, dropIndex) => {
      if (dragType === DragRegionType.Columns) {
        onColumnOrdered?.(flatRanges(ranges), dropIndex);
      }
      if (dragType === DragRegionType.Rows) {
        const { type: prevType } = getLinearRow(dropIndex - 1);
        const { type, realIndex } = getLinearRow(dropIndex);
        const originRealIndexs = flatRanges(ranges).map((index) => getLinearRow(index).realIndex);

        if (
          (prevType === LinearRowType.Row && type === LinearRowType.Append) ||
          (prevType === LinearRowType.Group && type === LinearRowType.Row && realIndex !== 0)
        ) {
          return onRowOrdered?.(originRealIndexs, realIndex + 1);
        }

        onRowOrdered?.(originRealIndexs, realIndex);
      }
      setActiveCell(null);
      setSelection(selection.reset());
      setCursor('default');
    });
    onColumnFreezeEnd((columnCount: number) => {
      onColumnFreeze?.(columnCount);
      setMouseState(DEFAULT_MOUSE_STATE);
    });
    onSelectionEnd();
    onColumnResizeEnd();
  };

  const onMouseLeave = () => {
    if (isInteracting) return;
    const { type, ...rest } = BLANK_REGION_DATA;
    onItemHovered?.(type, rest, [-Infinity, -Infinity]);
    setMouseState(DEFAULT_MOUSE_STATE);
    setHoveredColumnResizeIndex(-1);
  };

  const onContextMenuInner = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (event.cancelable) event.preventDefault();
    if (onContextMenu == null) return;
    const mouseState = getMouseState();
    onSelectionContextMenu(mouseState, (selection, position) => onContextMenu(selection, position));
  };

  const resetState = () => {
    setActiveCell(null);
    setDragState(DEFAULT_DRAG_STATE);
    setMouseState(DEFAULT_MOUSE_STATE);
    setSelection(selection.reset());
    setHoveredColumnResizeIndex(-1);
    setColumnResizeState(DEFAULT_COLUMN_RESIZE_STATE);
  };

  useEventListener('mousemove', onMouseMove, isInteracting ? window : stageRef.current, true);
  useEventListener('mouseup', onMouseUp, isInteracting ? window : stageRef.current, true);

  useClickAway(containerRef, () => {
    setEditing(false);
    editorContainerRef.current?.saveValue?.();
  });

  useLayoutEffect(() => {
    if (activeColumnIndex == null || activeRowIndex == null) return;
    cellScrollerRef.current?.reset();
  }, [activeColumnIndex, activeRowIndex]);

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        cursor,
      }}
    >
      <div
        ref={stageRef}
        className="size-full"
        onClick={onSmartClick}
        onMouseDown={onMouseDown}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenuInner}
      >
        <RenderLayer
          theme={theme}
          width={width}
          height={height}
          columns={columns}
          commentCountMap={commentCountMap}
          columnStatistics={columnStatistics}
          coordInstance={coordInstance}
          rowControls={rowControls}
          imageManager={imageManager}
          spriteManager={spriteManager}
          visibleRegion={visibleRegion}
          collaborators={collaborators}
          searchCursor={searchCursor}
          searchHitIndex={searchHitIndex}
          activeCellBound={activeCellBound}
          activeCell={activeCell}
          mouseState={mouseState}
          scrollState={scrollState}
          dragState={dragState}
          selection={selection}
          groupCollection={groupCollection}
          forceRenderFlag={forceRenderFlag}
          rowIndexVisible={rowIndexVisible}
          columnResizeState={columnResizeState}
          columnFreezeState={columnFreezeState}
          columnHeaderVisible={columnHeaderVisible}
          hoverCellPosition={hoverCellPosition}
          hoveredColumnResizeIndex={hoveredColumnResizeIndex}
          isRowAppendEnable={isRowAppendEnable}
          isColumnFreezable={isColumnFreezable}
          isColumnResizable={isColumnResizable}
          isColumnAppendEnable={isColumnAppendEnable}
          isColumnHeaderMenuVisible={isColumnHeaderMenuVisible}
          isEditing={isEditing}
          isSelecting={isSelecting}
          isInteracting={isInteracting}
          isMultiSelectionEnable={isMultiSelectionEnable}
          getCellContent={getCellContent}
          real2RowIndex={real2RowIndex}
          getLinearRow={getLinearRow}
        />
      </div>

      {activeCellBound?.scrollEnable && (
        <CellScroller
          ref={cellScrollerRef}
          style={{
            top: coordInstance.getRowOffset(activeCellBound.rowIndex) + 4,
            left:
              coordInstance.getColumnRelativeOffset(activeCellBound.columnIndex + 1, scrollLeft) -
              10,
          }}
          containerRef={containerRef}
          activeCellBound={activeCellBound}
          setCellScrollTop={setCellScrollTop}
          scrollEnable={regionType === RegionType.ActiveCell}
        />
      )}

      <EditorContainer
        ref={editorContainerRef}
        theme={theme}
        isEditing={isEditing}
        selection={selection}
        activeCell={activeCell}
        scrollState={scrollState}
        coordInstance={coordInstance}
        activeCellBound={activeCellBound}
        onCopy={onCopy}
        onPaste={onPaste}
        onUndo={onUndo}
        onRedo={onRedo}
        onDelete={onDelete}
        onChange={onCellEdited}
        onRowExpand={onRowExpand}
        setEditing={setEditing}
        setSelection={setSelection}
        setActiveCell={setActiveCell}
        getCellContent={getCellContent}
        real2RowIndex={real2RowIndex}
        scrollToItem={scrollToItem}
      />
    </div>
  );
};

export const InteractionLayer = forwardRef(InteractionLayerBase);
