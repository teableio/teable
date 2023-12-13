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
  useAutoScroll,
  useEventListener,
  useSmartClick,
  useSelection,
  useColumnResize,
} from './hooks';
import { useDrag } from './hooks/useDrag';
import { useVisibleRegion } from './hooks/useVisibleRegion';
import type {
  IActiveCellBound,
  ICellItem,
  ICellPosition,
  ICellRegionWithData,
  IInnerCell,
  IMouseState,
  IRange,
  IRowControlItem,
  IScrollState,
} from './interface';
import { MouseButtonType, RegionType, DragRegionType, SelectionRegionType } from './interface';
import type { CoordinateManager, ImageManager, SpriteManager } from './managers';
import { CombinedSelection } from './managers';
import { CellRegionType, getCellRenderer } from './renderers';
import { RenderLayer } from './RenderLayer';
import type { IRegionData } from './utils';
import { BLANK_REGION_DATA, flatRanges, getRegionData, inRange } from './utils';

const { columnAppendBtnWidth, columnHeadHeight, columnStatisticHeight } = GRID_DEFAULT;

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
    rowCounterVisible,
    isMultiSelectionEnable,
    collaborators,
    activeCellBound: _activeCellBound,
    activeCell,
    setActiveCell,
    setMouseState,
    scrollToItem,
    scrollBy,
    getCellContent,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    onRowExpand,
    onRowOrdered,
    onCellEdited,
    onSelectionChanged,
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
  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;
  const hasColumnResizeHandler = onColumnResize != null;
  const hasColumnHeaderMenu = onColumnHeaderMenuClick != null;

  const visibleRegion = useVisibleRegion(coordInstance, scrollState);
  const {
    columnResizeState,
    hoveredColumnResizeIndex,
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
  } = useSelection(
    coordInstance,
    setActiveCell,
    onSelectionChanged,
    selectable,
    isMultiSelectionEnable
  );
  const { dragState, setDragState, onDragStart, onDragChange, onDragEnd } = useDrag(
    coordInstance,
    scrollState,
    selection,
    draggable
  );

  const { isDragging, type: dragType } = dragState;
  const isResizing = columnResizeState.columnIndex > -1;
  const { isCellSelection, ranges: selectionRanges } = selection;
  const isInteracting = isSelecting || isDragging || isResizing;
  const [activeColumnIndex, activeRowIndex] = activeCell ?? [];

  const getPosition = () => {
    const x = mousePosition.elX;
    const y = mousePosition.elY;
    const { freezeRegionWidth, totalWidth, rowInitSize, columnInitSize } = coordInstance;
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

    return { x, y, rowIndex, columnIndex };
  };

  const getHoverCellPosition = (mouseState: IMouseState) => {
    const { rowIndex, columnIndex, x, y } = mouseState;
    const offsetX = coordInstance.getColumnOffset(columnIndex);
    const isCellRange = columnIndex > -1 && rowIndex > -1;
    let position: ICellPosition | null = null;

    if (isCellRange) {
      const cell = getCellContent([columnIndex, rowIndex]);
      const cellRenderer = getCellRenderer(cell.type);

      if (
        cellRenderer.needsHoverPosition ||
        (cellRenderer.needsHoverPositionWhenActive && isEqual(activeCell, [columnIndex, rowIndex]))
      ) {
        position = [
          columnIndex < freezeColumnCount ? x - offsetX : x - offsetX + scrollLeft,
          y - coordInstance.getRowOffset(rowIndex) + scrollTop,
        ];
      }
    }
    return position;
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
      coordInstance,
      scrollState,
      rowControls,
      isOutOfBounds,
      hasAppendRow,
      hasAppendColumn,
      columnStatistics,
      hasColumnHeaderMenu,
      hasColumnResizeHandler,
      isMultiSelectionEnable,
      activeCellBound,
      activeCell,
      columns,
      height,
      theme,
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
    if (isDragging) return setCursor('grabbing');

    switch (regionType) {
      case RegionType.AppendRow: {
        if (activeCell != null) return;
        return setCursor('pointer');
      }
      case RegionType.AppendColumn:
      case RegionType.ColumnHeaderMenu:
      case RegionType.ColumnDescription:
      case RegionType.RowHeaderCheckbox:
      case RegionType.RowHeaderExpandHandler:
      case RegionType.ColumnStatistic:
      case RegionType.AllCheckbox:
        return setCursor('pointer');
      case RegionType.RowHeaderDragHandler: {
        if (draggable === 'column' || draggable === 'none') {
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
    const { type, rowIndex, columnIndex } = mouseState;
    if (regionType !== type) return;

    switch (type) {
      case RegionType.AppendRow: {
        if (activeCell != null) {
          setSelection(selection.reset());
          return setActiveCell(null);
        } else {
          const range = [0, rowIndex] as IRange;
          setActiveCell(range);
          setSelection(new CombinedSelection(SelectionRegionType.Cells, [range, range]));
        }
        return onRowAppend?.();
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
      case RegionType.ColumnStatistic: {
        return onColumnStatisticClick?.(columnIndex, {
          x: coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft),
          y: containerHeight,
          width: coordInstance.getColumnWidth(columnIndex),
          height: columnStatisticHeight,
        });
      }
      case RegionType.Cell:
      case RegionType.ActiveCell: {
        const { columnIndex, rowIndex } = mouseState;
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
              height: coordInstance.getRowHeight(rowIndex),
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
      }
    }

    const { type: clickRegionType, ...rest } = hoveredRegionRef.current;
    onItemClick?.(clickRegionType, rest, [columnIndex, rowIndex]);
  };

  const onDblClick = () => {
    const mouseState = getMouseState();
    const { type, rowIndex, columnIndex } = mouseState;
    if (
      [RegionType.Cell, RegionType.ActiveCell].includes(type) &&
      isEqual(selectionRanges[0], [columnIndex, rowIndex])
    ) {
      const cell = getCellContent([columnIndex, rowIndex]) as IInnerCell;
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
        height: GRID_DEFAULT.columnHeadHeight,
      });
    }
  };

  const { onSmartClick, onSmartMouseDown, onSmartMouseUp } = useSmartClick(
    stageRef,
    onClick,
    onDblClick
  );

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.preventDefault();
    if (event.button === MouseButtonType.Right) return;
    const mouseState = getMouseState();
    setMouseState(mouseState);
    const { rowIndex, columnIndex } = mouseState;
    if (!(isCellSelection && isEqual(selectionRanges[0], [columnIndex, rowIndex]))) {
      setEditing(false);
      editorContainerRef.current?.saveValue?.();
    }
    onSmartMouseDown(mouseState);
    onDragStart(mouseState);
    prevActiveCellRef.current = activeCell;
    onSelectionStart(event, mouseState);
    hasColumnResizeHandler && onColumnResizeStart(mouseState);
  };

  const onCellPosition = (mouseState: IMouseState) => {
    const { columnIndex, rowIndex, type } = mouseState;
    const cell = getCellContent([columnIndex, rowIndex]);
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
    if (!isInteracting && !isEqual(hoveredRegionRef.current, previousHoveredRegionRef.current)) {
      const { type, ...rest } = hoveredRegionRef.current;
      const { columnIndex, rowIndex } = mouseState;
      onItemHovered?.(type, rest, [columnIndex, rowIndex]);
    }
    previousHoveredRegionRef.current = { ...hoveredRegionRef.current };
  };

  const onMouseUp = () => {
    const mouseState = getMouseState();
    setMouseState(mouseState);
    onAutoScrollStop();
    onSmartMouseUp(mouseState);
    onDragEnd(mouseState, (ranges, dropIndex) => {
      if (dragType === DragRegionType.Columns) {
        onColumnOrdered?.(flatRanges(ranges), dropIndex);
      }
      if (dragType === DragRegionType.Rows) {
        onRowOrdered?.(flatRanges(ranges), dropIndex);
      }
      setActiveCell(null);
      setSelection(selection.reset());
      setCursor('default');
    });
    onSelectionEnd();
    onColumnResizeEnd();
  };

  const onMouseLeave = () => {
    if (isInteracting) return;
    const { type, ...rest } = BLANK_REGION_DATA;
    onItemHovered?.(type, rest, [-Infinity, -Infinity]);
    setMouseState(DEFAULT_MOUSE_STATE);
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
    setColumnResizeState(DEFAULT_COLUMN_RESIZE_STATE);
  };

  useEventListener('mousemove', onMouseMove, isInteracting ? window : stageRef.current, true);

  useClickAway(containerRef, () => {
    setEditing(false);
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
        className="h-full w-full"
        onClick={onSmartClick}
        onMouseUp={onMouseUp}
        onMouseDown={onMouseDown}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenuInner}
      >
        <RenderLayer
          theme={theme}
          width={width}
          height={height}
          columns={columns}
          columnStatistics={columnStatistics}
          coordInstance={coordInstance}
          isEditing={isEditing}
          rowControls={rowControls}
          imageManager={imageManager}
          spriteManager={spriteManager}
          visibleRegion={visibleRegion}
          collaborators={collaborators}
          activeCellBound={activeCellBound}
          activeCell={activeCell}
          mouseState={mouseState}
          scrollState={scrollState}
          dragState={dragState}
          selection={selection}
          isSelecting={isSelecting}
          forceRenderFlag={forceRenderFlag}
          rowIndexVisible={rowIndexVisible}
          rowCounterVisible={rowCounterVisible}
          columnResizeState={columnResizeState}
          hoverCellPosition={hoverCellPosition}
          hoveredColumnResizeIndex={hoveredColumnResizeIndex}
          isMultiSelectionEnable={isMultiSelectionEnable}
          getCellContent={getCellContent}
          isRowAppendEnable={onRowAppend != null}
          isColumnResizable={hasColumnResizeHandler}
          isColumnAppendEnable={onColumnAppend != null}
          isColumnHeaderMenuVisible={hasColumnHeaderMenu}
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
        scrollToItem={scrollToItem}
        setEditing={setEditing}
        activeCell={activeCell}
        setActiveCell={setActiveCell}
        activeCellBound={activeCellBound}
        selection={selection}
        setSelection={setSelection}
        getCellContent={getCellContent}
        scrollState={scrollState}
        coordInstance={coordInstance}
        onCopy={onCopy}
        onPaste={onPaste}
        onDelete={onDelete}
        onChange={onCellEdited}
        onRowAppend={onRowAppend}
        onRowExpand={onRowExpand}
      />
    </div>
  );
};

export const InteractionLayer = forwardRef(InteractionLayerBase);
