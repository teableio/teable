/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { isEqual } from 'lodash';
import type { Dispatch, FC, SetStateAction } from 'react';
import { useState, useRef, useCallback, useMemo } from 'react';
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
import type { IActiveCellData, IInnerCell, IMouseState, IScrollState } from './interface';
import { MouseButtonType, SelectionRegionType, RegionType } from './interface';
import type { CoordinateManager, ImageManager, SpriteManager } from './managers';
import { bufferCtx, getCellRenderer } from './renderers';
import { RenderLayer } from './RenderLayer';
import { getRegionType } from './utils';

export interface IInteractionLayerProps
  extends Omit<
    IGridProps,
    'freezeColumnCount' | 'rowCount' | 'rowHeight' | 'style' | 'smoothScrollX' | 'smoothScrollY'
  > {
  theme: IGridTheme;
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
    onDelete,
    onRowAppend,
    onCellEdited,
    onCellActivated,
    onColumnAppend,
    onColumnResize,
    onColumnOrdered,
    onVisibleRegionChanged,
    onColumnHeaderMenuClick,
  } = props;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const editorContainerRef = useRef<IEditorContainerRef>(null);
  const [cursor, setCursor] = useState('default');
  const [isEditing, setEditing] = useState(false);
  const { containerWidth, containerHeight, freezeColumnCount, pureRowCount } = coordInstance;
  const { scrollTop, scrollLeft } = scrollState;
  const { type: regionType } = mouseState;
  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;

  const { startRowIndex, stopRowIndex, startColumnIndex, stopColumnIndex } = useVisibleRegion(
    coordInstance,
    scrollState,
    onVisibleRegionChanged
  );
  const { columnResizeState, onColumnResizeStart, onColumnResizeChange, onColumnResizeEnd } =
    useColumnResize(coordInstance, scrollState);
  const { dragState, onDragStart, onDragChange, onDragEnd } = useDrag(coordInstance, scrollState);
  const {
    selectionState,
    setSelectionState,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
  } = useSelection();

  const { type: selectionType, ranges: selectionRanges } = selectionState;

  const activeCellData: IActiveCellData | null = useMemo(() => {
    const { type, ranges } = selectionState;
    if (type !== SelectionRegionType.Cells) return null;
    const cell = getCellContent(ranges[0]);
    const cellRenderer = getCellRenderer(cell.type);
    const [columnIndex, rowIndex] = ranges[0];
    const width = coordInstance.getColumnWidth(columnIndex);
    let height = coordInstance.getRowHeight(rowIndex);
    if (cellRenderer.measure && bufferCtx) {
      height = Math.max(
        cellRenderer.measure(cell as never, { ctx: bufferCtx, width, theme }) || height,
        height
      );
    }
    return {
      rowIndex,
      columnIndex,
      width,
      height,
    };
  }, [coordInstance, selectionState, getCellContent, theme]);

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
    selectionState,
    setSelectionState,
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
    if (dragState.isDragging) {
      return setCursor('grabbing');
    }

    switch (regionType) {
      case RegionType.AppendRow:
      case RegionType.AppendColumn:
      case RegionType.ColumnHeaderMenu:
      case RegionType.RowHeaderCheckbox:
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
    setMouseState(mouseState);
    onDragStart(mouseState);
    onSelectionStart(mouseState);
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
    onDragChange();
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
    onDragEnd(mouseState, (columnIndex, targetColumnIndex) => {
      onColumnOrdered?.(columns[columnIndex], columnIndex, targetColumnIndex);
      setSelectionState(DEFAULT_SELECTION_STATE);
      setCursor('default');
    });
    onSelectionEnd((isEditMode: boolean) => setEditing(isEditMode));
    onColumnResizeEnd();
  };

  const onMouseLeave = () => {
    setMouseState(DEFAULT_MOUSE_STATE);
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
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <RenderLayer
          theme={theme}
          columns={columns}
          coordInstance={coordInstance}
          isEditing={isEditing}
          rowControls={rowControls}
          imageManager={imageManager}
          spriteManager={spriteManager}
          scrollState={scrollState}
          startRowIndex={startRowIndex}
          stopRowIndex={stopRowIndex}
          startColumnIndex={startColumnIndex}
          stopColumnIndex={stopColumnIndex}
          mouseState={mouseState}
          dragState={dragState}
          selectionState={selectionState}
          columnResizeState={columnResizeState}
          activeCellData={activeCellData}
          onDelete={onDelete}
          onColumnOrdered={onColumnOrdered}
          getCellContent={getCellContent}
          onRowAppend={onRowAppend}
          onColumnResize={onColumnResize}
          onColumnAppend={onColumnAppend}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
        />
      </div>
      <EditorContainer
        ref={editorContainerRef}
        theme={theme}
        isEditing={isEditing}
        scrollTo={scrollTo}
        setEditing={setEditing}
        selectionState={selectionState}
        setSelectionState={setSelectionState}
        getCellContent={getCellContent}
        scrollState={scrollState}
        coordInstance={coordInstance}
        onCellActivated={onCellActivated}
        onChange={onCellEdited}
        onDelete={onDelete}
      />
    </>
  );
};
