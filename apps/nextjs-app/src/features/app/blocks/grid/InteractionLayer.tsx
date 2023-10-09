/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { useView } from '@teable-group/sdk/hooks/use-view';
import { isEqual } from 'lodash';

import type { Dispatch, ForwardRefRenderFunction, SetStateAction } from 'react';
import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { useClickAway, useMouse } from 'react-use';
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
  ICellItem,
  ICellPosition,
  IInnerCell,
  IMouseState,
  IRowControlItem,
  IScrollState,
} from './interface';
import { MouseButtonType, RegionType, DragRegionType, SelectionRegionType } from './interface';
import type { CombinedSelection, CoordinateManager, ImageManager, SpriteManager } from './managers';
import { CellType, getCellRenderer } from './renderers';
import { RenderLayer } from './RenderLayer';
import { flatRanges, getRegionType, inRange } from './utils';

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
  setMouseState: Dispatch<SetStateAction<IMouseState>>;
  scrollBy: (deltaX: number, deltaY: number) => void;
  scrollToItem: (position: [columnIndex: number, rowIndex: number]) => void;
}

export interface IInteractionLayerRef {
  onReset: () => void;
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
    rowControls,
    mouseState,
    scrollState,
    imageManager,
    spriteManager,
    coordInstance,
    columnStatistics,
    forceRenderFlag,
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
    onCellActivated,
    onSelectionChanged,
    onColumnAppend,
    onColumnResize,
    onColumnOrdered,
    onContextMenu,
    onColumnHeaderClick,
    onColumnHeaderDblClick,
    onColumnHeaderMenuClick,
    onColumnStatisticClick,
  } = props;

  const view = useView();

  useImperativeHandle(ref, () => ({
    onReset,
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
  const mousePosition = useMouse(stageRef);
  const editorContainerRef = useRef<IEditorContainerRef>(null);
  const [hoverCellPosition, setHoverCellPosition] = useState<ICellPosition | null>(null);
  const [cursor, setCursor] = useState('default');
  const [isEditing, setEditing] = useState(false);
  const { containerHeight, freezeColumnCount } = coordInstance;
  const { scrollTop, scrollLeft, isScrolling } = scrollState;
  const { type: regionType } = mouseState;
  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;

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
    activeCell,
    selection,
    isSelecting,
    setActiveCell,
    setSelection,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
    onSelectionContextMenu,
  } = useSelection(coordInstance, onSelectionChanged);
  const { dragState, setDragState, onDragStart, onDragChange, onDragEnd } = useDrag(
    coordInstance,
    scrollState,
    selection
  );

  const { isDragging, type: dragType } = dragState;
  const isResizing = columnResizeState.columnIndex > -1;
  const { isCellSelection, ranges: selectionRanges } = selection;

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

      if (cellRenderer.needsHoverPosition) {
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

  const getMouseState = () => {
    const position = getPosition();
    const { x, y } = position;
    const { totalHeight, totalWidth } = coordInstance;
    const isOutOfBounds =
      scrollLeft + x > totalWidth + columnAppendBtnWidth ||
      (scrollTop + y > totalHeight && !inRange(y, containerHeight, height));
    return {
      ...position,
      type: getRegionType({
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
        height,
        theme,
      }),
      isOutOfBounds,
    };
  };

  const setCursorStyle = (regionType: RegionType) => {
    if (isScrolling) return;
    if (isDragging) {
      return setCursor('grabbing');
    }

    switch (regionType) {
      case RegionType.AppendRow:
      case RegionType.AppendColumn:
      case RegionType.ColumnHeaderMenu:
      case RegionType.RowHeaderCheckbox:
      case RegionType.RowHeaderExpandHandler:
      case RegionType.ColumnStatistic:
      case RegionType.AllCheckbox:
        return setCursor('pointer');
      case RegionType.RowHeaderDragHandler:
        return setCursor('grabbing');
      case RegionType.ColumnResizeHandler:
        return setCursor('ew-resize');
      case RegionType.FillHandler:
        return setCursor('crosshair');
      default:
        setCursor('default');
    }
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const mouseState = getMouseState();
    onSelectionClick(event, mouseState);
    const { type, rowIndex, columnIndex } = mouseState;
    if (regionType !== type) return;

    switch (type) {
      case RegionType.AppendRow:
        return onRowAppend?.();
      case RegionType.AppendColumn:
        return onColumnAppend?.();
      case RegionType.RowHeaderExpandHandler:
        return onRowExpand?.(rowIndex);
      case RegionType.ColumnResizeHandler:
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
      case RegionType.Cell: {
        const { columnIndex, rowIndex } = mouseState;
        const cell = getCellContent([columnIndex, rowIndex]);
        const cellRenderer = getCellRenderer(cell.type);
        const cellClick = cellRenderer.onClick;
        if (cellClick && onCellEdited && hoverCellPosition) {
          const newValue = cellClick(cell as never, {
            width: coordInstance.getColumnWidth(columnIndex),
            height: coordInstance.getRowHeight(rowIndex),
            hoverCellPosition,
            theme,
          });
          if (newValue === undefined) return;
          onCellEdited([columnIndex, rowIndex], {
            ...cell,
            data: newValue,
          } as IInnerCell);
        }
      }
    }
  };

  const onDblClick = () => {
    const mouseState = getMouseState();
    const { type, rowIndex, columnIndex } = mouseState;
    if (type === RegionType.Cell && isEqual(selectionRanges[0], [columnIndex, rowIndex])) {
      editorContainerRef.current?.focus?.();
      setEditing(true);
    }
    if (
      type === RegionType.ColumnHeader &&
      isEqual(selectionRanges[0], [columnIndex, columnIndex])
    ) {
      onColumnHeaderDblClick?.(columnIndex, {
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
      editorContainerRef.current?.saveValue?.();
      setEditing(false);
    }
    onSmartMouseDown(mouseState);
    onDragStart(mouseState);
    onSelectionStart(event, mouseState);
    onColumnResizeStart(mouseState);
  };

  const onCellPosition = (mouseState: IMouseState) => {
    const { columnIndex, rowIndex } = mouseState;
    const cell = getCellContent([columnIndex, rowIndex]);
    const cellRenderer = getCellRenderer(cell.type);
    if (cellRenderer.needsHover && hoverCellPosition) {
      const isBound = cellRenderer.checkWithinBound?.(cell as never, {
        width: coordInstance.getColumnWidth(columnIndex),
        height: coordInstance.getRowHeight(rowIndex),
        hoverCellPosition,
        theme,
      });
      return isBound ? setCursor('pointer') : undefined;
    }
    if (cellRenderer.needsHover) {
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
    !view?.sort?.shouldAutoSort && onDragChange(mouseState);
    onSelectionChange(mouseState);
    onColumnResizeChange(mouseState, (newWidth, columnIndex) => {
      onColumnResize?.(columns[columnIndex], newWidth, columnIndex);
    });
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
    onSelectionEnd(mouseState, (item: ICellItem) => {
      const cell = getCellContent(item);
      const canEditOnClick = [CellType.Number, CellType.Text, CellType.Select].includes(cell.type);
      canEditOnClick && setEditing(true);
    });
    onColumnResizeEnd();
  };

  const onMouseLeave = () => {
    if (isSelecting || isDragging) return;
    setMouseState(DEFAULT_MOUSE_STATE);
  };

  const onContextMenuInner = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (event.cancelable) event.preventDefault();
    if (onContextMenu == null) return;
    const mouseState = getMouseState();
    onSelectionContextMenu(mouseState, (selection, position) => onContextMenu(selection, position));
  };

  const onReset = () => {
    setActiveCell(null);
    setDragState(DEFAULT_DRAG_STATE);
    setMouseState(DEFAULT_MOUSE_STATE);
    setSelection(selection.reset());
    setColumnResizeState(DEFAULT_COLUMN_RESIZE_STATE);
  };

  useEventListener(
    'mousemove',
    onMouseMove,
    isSelecting || isDragging || isResizing ? window : stageRef.current,
    true
  );

  useClickAway(containerRef, () => {
    editorContainerRef.current?.saveValue?.();
    setEditing(false);
  });

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
        className="w-full h-full"
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
          activeCell={activeCell}
          mouseState={mouseState}
          scrollState={scrollState}
          dragState={dragState}
          selection={selection}
          isSelecting={isSelecting}
          forceRenderFlag={forceRenderFlag}
          columnResizeState={columnResizeState}
          hoverCellPosition={hoverCellPosition}
          hoveredColumnResizeIndex={hoveredColumnResizeIndex}
          getCellContent={getCellContent}
          isRowAppendEnable={onRowAppend != null}
          isColumnResizable={onColumnResize != null}
          isColumnAppendEnable={onColumnAppend != null}
          isColumnHeaderMenuVisible={onColumnHeaderMenuClick != null}
        />
      </div>

      <EditorContainer
        ref={editorContainerRef}
        theme={theme}
        isEditing={isEditing}
        scrollToItem={scrollToItem}
        setEditing={setEditing}
        activeCell={activeCell}
        setActiveCell={setActiveCell}
        selection={selection}
        setSelection={setSelection}
        getCellContent={getCellContent}
        scrollState={scrollState}
        coordInstance={coordInstance}
        onCellActivated={onCellActivated}
        onChange={onCellEdited}
        onCopy={onCopy}
        onPaste={onPaste}
        onDelete={onDelete}
        onRowAppend={onRowAppend}
        onRowExpand={onRowExpand}
      />
    </div>
  );
};

export const InteractionLayer = forwardRef(InteractionLayerBase);
