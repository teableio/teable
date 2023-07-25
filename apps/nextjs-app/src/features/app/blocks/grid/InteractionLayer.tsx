/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { isEqual } from 'lodash';
import type { Dispatch, FC, SetStateAction } from 'react';
import { useState, useRef, useCallback } from 'react';
import type { IEditorContainerRef } from './components';
import { EditorContainer } from './components';
import type { IGridTheme } from './configs';
import { DEFAULT_SELECTION_STATE, DEFAULT_MOUSE_STATE, GRID_DEFAULT } from './configs';
import type { IGridProps } from './Grid';
import { useAutoScroll, useSmartClick } from './hooks';
import { useColumnResize } from './hooks/useColumnResize';
import { useDrag } from './hooks/useDrag';
import { useSelection } from './hooks/useSelection';
import { useVisibleRegion } from './hooks/useVisibleRegion';
import type { ICellItem, IInnerCell, IMouseState, IScrollState, RowControlType } from './interface';
import { MouseButtonType, SelectionRegionType, RegionType, DragRegionType } from './interface';
import type { CoordinateManager, ImageManager, SpriteManager } from './managers';
import { CellType, getCellRenderer } from './renderers';
import { RenderLayer } from './RenderLayer';
import { getRegionType } from './utils';

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
  rowControls: RowControlType[];
  mouseState: IMouseState;
  scrollState: IScrollState;
  imageManager: ImageManager;
  spriteManager: SpriteManager;
  coordInstance: CoordinateManager;
  setMouseState: Dispatch<SetStateAction<IMouseState>>;
  scrollTo: (sl?: number, st?: number) => void;
  scrollBy: (deltaX: number, deltaY: number) => void;
}

export const InteractionLayer: FC<IInteractionLayerProps> = (props) => {
  const {
    theme,
    columns,
    rowControls,
    mouseState,
    scrollState,
    imageManager,
    spriteManager,
    coordInstance,
    setMouseState,
    scrollTo,
    scrollBy,
    getCellContent,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    onRowOrdered,
    onCellEdited,
    onCellActivated,
    onColumnAppend,
    onColumnResize,
    onColumnOrdered,
    onContextMenu,
    onColumnHeaderMenuClick,
  } = props;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const editorContainerRef = useRef<IEditorContainerRef>(null);
  const [cursor, setCursor] = useState('default');
  const [isEditing, setEditing] = useState(false);
  const { containerWidth, containerHeight, freezeColumnCount, pureRowCount } = coordInstance;
  const { scrollTop, scrollLeft, isScrolling } = scrollState;
  const { type: regionType } = mouseState;
  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;

  const { startRowIndex, stopRowIndex, startColumnIndex, stopColumnIndex } = useVisibleRegion(
    coordInstance,
    scrollState
  );
  const { columnResizeState, onColumnResizeStart, onColumnResizeChange, onColumnResizeEnd } =
    useColumnResize(coordInstance, scrollState);
  const { dragState, onDragStart, onDragChange, onDragEnd } = useDrag(coordInstance, scrollState);
  const {
    activeCell,
    setActiveCell,
    selectionState,
    setSelectionState,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
    onSelectionContextMenu,
  } = useSelection();

  const { isDragging, type: dragType } = dragState;
  const { type: selectionType, ranges: selectionRanges, isSelecting } = selectionState;

  const getPosition = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect == null) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const { columnAppendBtnWidth } = GRID_DEFAULT;
      const { freezeRegionWidth, totalWidth, rowInitSize, columnInitSize, freezeColumnCount } =
        coordInstance;
      const rowIndex = y <= rowInitSize ? -1 : coordInstance.getRowStartIndex(scrollTop + y);
      const columnIndex =
        scrollLeft + x > totalWidth && scrollLeft + x < totalWidth + columnAppendBtnWidth
          ? -2
          : x <= freezeRegionWidth
          ? x <= columnInitSize
            ? -1
            : coordInstance.getColumnStartIndex(x)
          : coordInstance.getColumnStartIndex(scrollLeft + x);
      const offsetX = coordInstance.getColumnOffset(columnIndex);
      const isCellRange = columnIndex > -1 && rowIndex > -1;
      const hoverCellX = isCellRange
        ? columnIndex < freezeColumnCount
          ? x - offsetX
          : x - offsetX + scrollLeft
        : 0;
      const hoverCellY = isCellRange ? y - coordInstance.getRowOffset(rowIndex) + scrollTop : 0;
      return { x, y, rowIndex, columnIndex, hoverCellX, hoverCellY };
    },
    [coordInstance, scrollLeft, scrollTop]
  );

  const { onAutoScroll, onAutoScrollStop } = useAutoScroll({
    coordInstance,
    isSelecting,
    isDragging,
    dragType,
    scrollBy,
  });

  const getMouseState = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const position = getPosition(event);
    if (position == null) return;
    const { x, y } = position;
    const { columnAppendBtnWidth } = GRID_DEFAULT;
    const { totalHeight, totalWidth } = coordInstance;
    const isOutOfBounds =
      scrollLeft + x > totalWidth + columnAppendBtnWidth || scrollTop + y > totalHeight;
    return {
      ...position,
      type: getRegionType({
        position,
        dragState,
        selectionState,
        columnResizeState,
        coordInstance,
        scrollState,
        rowControls,
        isOutOfBounds,
        hasAppendRow,
        hasAppendColumn,
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
      case RegionType.RowHeaderDragHandler:
      case RegionType.RowHeaderExpandHandler:
      case RegionType.AllCheckbox:
        return setCursor('pointer');
      case RegionType.ColumnResizeHandler:
        return setCursor('ew-resize');
      case RegionType.FillHandler:
        return setCursor('crosshair');
      default:
        setCursor('default');
    }
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const mouseState = getMouseState(event);
    if (mouseState == null) return;
    onSelectionClick(mouseState, pureRowCount);
    const { type, columnIndex, hoverCellX, hoverCellY } = mouseState;
    if (regionType !== type) return;

    switch (type) {
      case RegionType.AppendRow:
        return onRowAppend?.();
      case RegionType.AppendColumn:
        return onColumnAppend?.();
      case RegionType.ColumnHeaderMenu: {
        const x = coordInstance.getColumnOffset(columnIndex);
        return onColumnHeaderMenuClick?.(columnIndex, {
          x: columnIndex < freezeColumnCount ? x : x - scrollLeft,
          y: 0,
          width: coordInstance.getColumnWidth(columnIndex),
          height: GRID_DEFAULT.columnHeadHeight,
        });
      }
      case RegionType.Cell: {
        const { columnIndex, rowIndex } = mouseState;
        const cell = getCellContent([columnIndex, rowIndex]);
        if (cell.readonly) return;
        const cellRenderer = getCellRenderer(cell.type);
        const cellClick = cellRenderer.onClick;
        if (cellClick) {
          const newValue = cellClick(cell as never, {
            hoverCellX,
            hoverCellY,
            width: coordInstance.getColumnWidth(columnIndex),
            height: coordInstance.getRowHeight(rowIndex),
            theme,
          });
          if (newValue === undefined) return;
          onCellEdited?.([columnIndex, rowIndex], {
            ...cell,
            data: newValue,
          } as IInnerCell);
        }
      }
    }
  };

  const onDblClick = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const mouseState = getMouseState(event);
    if (mouseState == null || selectionType !== SelectionRegionType.Cells) return;
    const { rowIndex, columnIndex } = mouseState;
    if (isEqual(selectionRanges[0], [columnIndex, rowIndex])) {
      editorContainerRef.current?.focus?.();
      setEditing(true);
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
    const mouseState = getMouseState(event);
    if (mouseState == null) return;
    setMouseState(mouseState);
    const { rowIndex, columnIndex } = mouseState;
    if (
      !(
        selectionType === SelectionRegionType.Cells &&
        isEqual(selectionRanges[0], [columnIndex, rowIndex])
      )
    ) {
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
    if (!cell.readonly && cellRenderer.needsHover) {
      setCursor('pointer');
    }
  };

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const mouseState = getMouseState(event);
    if (mouseState == null) return;
    const { type } = mouseState;
    setMouseState(mouseState);
    setCursorStyle(type);
    onCellPosition(mouseState);
    onAutoScroll(mouseState);
    onDragChange(mouseState);
    onSelectionChange(mouseState);
    onColumnResizeChange(mouseState, (newWidth, columnIndex) => {
      onColumnResize?.(columns[columnIndex], newWidth, columnIndex, newWidth);
    });
  };

  const onMouseUp = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const mouseState = getMouseState(event);
    if (mouseState == null) return;
    setMouseState(mouseState);
    onAutoScrollStop();
    onSmartMouseUp(mouseState);
    onDragEnd(mouseState, (dragIndex, dropIndex) => {
      if (dragType === DragRegionType.Column) {
        onColumnOrdered?.([dragIndex], dropIndex);
      }
      if (dragType === DragRegionType.Row) {
        onRowOrdered?.(dragIndex, dropIndex);
      }
      setSelectionState(DEFAULT_SELECTION_STATE);
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
    setMouseState(DEFAULT_MOUSE_STATE);
  };

  const onContextMenuInner = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (event.cancelable) event.preventDefault();
    if (onContextMenu == null) return;
    const mouseState = getMouseState(event);
    if (mouseState == null) return;
    onSelectionContextMenu(mouseState, (selection, position) => onContextMenu(selection, position));
  };

  return (
    <>
      <div
        ref={stageRef}
        style={{
          width: containerWidth,
          height: containerHeight,
          cursor,
        }}
        onClick={onSmartClick}
        onMouseUp={onMouseUp}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenuInner}
      >
        <RenderLayer
          theme={theme}
          columns={columns}
          coordInstance={coordInstance}
          isEditing={isEditing}
          rowControls={rowControls}
          imageManager={imageManager}
          spriteManager={spriteManager}
          startRowIndex={startRowIndex}
          stopRowIndex={stopRowIndex}
          startColumnIndex={startColumnIndex}
          stopColumnIndex={stopColumnIndex}
          activeCell={activeCell}
          mouseState={mouseState}
          scrollState={scrollState}
          dragState={dragState}
          selectionState={selectionState}
          columnResizeState={columnResizeState}
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
        scrollTo={scrollTo}
        setEditing={setEditing}
        activeCell={activeCell}
        setActiveCell={setActiveCell}
        selectionState={selectionState}
        setSelectionState={setSelectionState}
        getCellContent={getCellContent}
        scrollState={scrollState}
        coordInstance={coordInstance}
        onCellActivated={onCellActivated}
        onChange={onCellEdited}
        onCopy={onCopy}
        onPaste={onPaste}
        onDelete={onDelete}
      />
    </>
  );
};
