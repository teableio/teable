import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { isEqual } from 'lodash';
import dynamic from 'next/dynamic';
import type { FC } from 'react';
import { useState, useRef, useCallback } from 'react';
import { EditorContainer } from './components';
import type { IGridTheme } from './configs';
import { DEFAULT_SELECTION_STATE, DEFAULT_MOUSE_STATE, GRID_DEFAULT } from './configs';
import type { IGridProps } from './Grid';
import { useAutoScroll, useSmartClick } from './hooks';
import { useColumnResize } from './hooks/useColumnResize';
import { useDrag } from './hooks/useDrag';
import { useSelection } from './hooks/useSelection';
import { useVisibleRegion } from './hooks/useVisibleRegion';
import type { IMouseState, IScrollState } from './interface';
import { MouseButtonType, SelectionRegionType, RegionType } from './interface';
import type { CoordinateManager, SpriteManager } from './managers';
import { RenderLayer } from './RenderLayer';
import { getRegionType } from './utils';

Konva.pixelRatio = 2;

const Stage = dynamic(() => import('./components/base/Stage'), { ssr: false });

export interface IInteractionLayerProps
  extends Omit<
    IGridProps,
    'freezeColumnCount' | 'rowCount' | 'rowHeight' | 'style' | 'smoothScrollX' | 'smoothScrollY'
  > {
  theme: IGridTheme;
  scrollState: IScrollState;
  spriteManager: SpriteManager;
  coordInstance: CoordinateManager;
  scrollTo: (sl?: number, st?: number) => void;
  scrollBy: (deltaX: number, deltaY: number) => void;
}

export const InteractionLayer: FC<IInteractionLayerProps> = (props) => {
  const {
    theme,
    columns,
    rowControls,
    scrollState,
    spriteManager,
    coordInstance,
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
    onColumnHeaderMenuClick,
  } = props;
  const [mouseState, setMouseState] = useState<IMouseState>(DEFAULT_MOUSE_STATE);
  const stageRef = useRef<Konva.Stage>();
  const [cursor, setCursor] = useState('default');
  const [isEditing, setEditing] = useState(false);
  const { containerWidth, containerHeight, freezeColumnCount, rowCount } = coordInstance;
  const { isScrolling, scrollTop, scrollLeft } = scrollState;
  const { type: regionType } = mouseState;
  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;
  const pureRowCount = hasAppendRow ? rowCount - 1 : rowCount;

  const { startRowIndex, stopRowIndex, startColumnIndex, stopColumnIndex } = useVisibleRegion(
    coordInstance,
    scrollState
  );
  const { columnResizeState, onColumnResizeStart, onColumnResizeChange, onColumnResizeEnd } =
    useColumnResize(coordInstance);
  const { dragState, onDragStart, onDragChange, onDragEnd } = useDrag(coordInstance, scrollState);
  const {
    selectionState,
    setSelectionState,
    onSelectionStart,
    onSelectionChange,
    onSelectionEnd,
    onSelectionClick,
  } = useSelection(pureRowCount);

  const { type: selectionType, ranges: selectionRanges } = selectionState;

  const getPosition = useCallback(() => {
    const pos = stageRef.current?.getPointerPosition();
    if (pos == null) return null;
    const { x, y } = pos;
    const { columnAppendBtnWidth } = GRID_DEFAULT;
    const { freezeRegionWidth, totalWidth, rowInitSize, columnInitSize } = coordInstance;
    const rowIndex = y <= rowInitSize ? -1 : coordInstance.getRowStartIndex(scrollTop + y);
    const columnIndex =
      scrollLeft + x > totalWidth && scrollLeft + x < totalWidth + columnAppendBtnWidth
        ? -2
        : x <= freezeRegionWidth
        ? x <= columnInitSize
          ? -1
          : coordInstance.getColumnStartIndex(x)
        : coordInstance.getColumnStartIndex(scrollLeft + x);
    return { x, y, rowIndex, columnIndex };
  }, [coordInstance, scrollLeft, scrollTop]);

  const { onAutoScroll, onAutoScrollStop } = useAutoScroll(
    coordInstance,
    selectionState,
    setSelectionState,
    getPosition,
    scrollBy
  );

  const getMouseState = () => {
    const position = getPosition();
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

  const onClick = () => {
    const mouseState = getMouseState();
    if (mouseState == null) return;
    onSelectionClick(mouseState);
    const { columnIndex, type } = mouseState;
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
    }
  };

  const onDblClick = () => {
    const mouseState = getMouseState();
    if (mouseState == null || selectionType !== SelectionRegionType.Cells) return;
    const { rowIndex, columnIndex } = mouseState;
    if (isEqual(selectionRanges[0], [columnIndex, rowIndex])) {
      setEditing(true);
    }
  };

  const { onSmartClick, onSmartMouseDown, onSmartMouseUp } = useSmartClick(
    stageRef,
    onClick,
    onDblClick
  );

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const mouseEvent = e.evt;
    mouseEvent.preventDefault();
    if (mouseEvent.button === MouseButtonType.Right) return;
    const mouseState = getMouseState();
    if (mouseState == null) return;
    const { rowIndex, columnIndex } = mouseState;
    if (
      !(
        selectionType === SelectionRegionType.Cells &&
        isEqual(selectionRanges[0], [columnIndex, rowIndex])
      )
    ) {
      setEditing(false);
    }
    onSmartMouseDown();
    setMouseState(mouseState);
    onDragStart(mouseState);
    onSelectionStart(mouseState);
    onColumnResizeStart(mouseState);
  };

  const onMouseMove = () => {
    const mouseState = getMouseState();
    if (mouseState == null) return;
    const { type } = mouseState;
    setMouseState(mouseState);
    setCursorStyle(type);
    onAutoScroll(mouseState);
    onDragChange();
    onSelectionChange(mouseState);
    onColumnResizeChange(mouseState, (newWidth, columnIndex) => {
      onColumnResize?.(columns[columnIndex], newWidth, columnIndex, newWidth);
    });
  };

  const onMouseUp = () => {
    const mouseState = getMouseState();
    if (mouseState == null) return;
    setMouseState(mouseState);
    onAutoScrollStop();
    onSmartMouseUp();
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
      <Stage
        stageRef={stageRef}
        width={containerWidth}
        height={containerHeight}
        listening={!isScrolling}
        onClick={onSmartClick}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ cursor }}
      >
        <RenderLayer
          theme={theme}
          columns={columns}
          coordInstance={coordInstance}
          isEditing={isEditing}
          rowControls={rowControls}
          spriteManager={spriteManager}
          scrollState={scrollState}
          startRowIndex={startRowIndex}
          stopRowIndex={stopRowIndex}
          startColumnIndex={startColumnIndex}
          stopColumnIndex={stopColumnIndex}
          mouseState={mouseState}
          selectionState={selectionState}
          dragState={dragState}
          columnResizeState={columnResizeState}
          onDelete={onDelete}
          onColumnOrdered={onColumnOrdered}
          getCellContent={getCellContent}
          onRowAppend={onRowAppend}
          onColumnResize={onColumnResize}
          onColumnAppend={onColumnAppend}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
        />
      </Stage>
      <EditorContainer
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
