import type { Dispatch, FC, SetStateAction } from 'react';
import { useRef } from 'react';
import ReactHammer from 'react-hammerjs';
import {
  DEFAULT_COLUMN_RESIZE_STATE,
  DEFAULT_DRAG_STATE,
  DEFAULT_MOUSE_STATE,
  GRID_DEFAULT,
  type IGridTheme,
} from './configs';
import type { IGridProps } from './Grid';
import { useSelection, useVisibleRegion } from './hooks';
import { RegionType, SelectionRegionType } from './interface';
import type { ICellItem, IMouseState, IRange, IRowControlItem, IScrollState } from './interface';
import type { CoordinateManager, ImageManager, SpriteManager } from './managers';
import { emptySelection } from './managers';
import { RenderLayer } from './RenderLayer';

export interface ITouchLayerProps
  extends Omit<
    IGridProps,
    | 'style'
    | 'rowCount'
    | 'rowHeight'
    | 'smoothScrollX'
    | 'smoothScrollY'
    | 'freezeColumnCount'
    | 'onCopy'
    | 'onPaste'
    | 'onRowOrdered'
    | 'onColumnResize'
    | 'onColumnOrdered'
    | 'onColumnHeaderDblClick'
    | 'onColumnHeaderMenuClick'
    | 'onVisibleRegionChanged'
  > {
  theme: IGridTheme;
  width: number;
  height: number;
  forceRenderFlag: string;
  mouseState: IMouseState;
  scrollState: IScrollState;
  imageManager: ImageManager;
  spriteManager: SpriteManager;
  coordInstance: CoordinateManager;
  rowControls: IRowControlItem[];
  setMouseState: Dispatch<SetStateAction<IMouseState>>;
  setActiveCell: Dispatch<SetStateAction<ICellItem | null>>;
}

const { columnAppendBtnWidth, columnHeadHeight } = GRID_DEFAULT;

export const TouchLayer: FC<ITouchLayerProps> = (props) => {
  const {
    width,
    height,
    theme,
    columns,
    columnStatistics,
    coordInstance,
    scrollState,
    mouseState,
    rowControls,
    imageManager,
    spriteManager,
    forceRenderFlag,
    getCellContent,
    setActiveCell,
    setMouseState,
    onRowAppend,
    onRowExpand,
    onColumnAppend,
    onColumnHeaderClick,
    onSelectionChanged,
  } = props;
  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;
  const { scrollTop, scrollLeft } = scrollState;
  const { freezeRegionWidth, totalWidth, columnInitSize, rowCount, rowInitSize } = coordInstance;

  const containerRef = useRef<HTMLDivElement | null>(null);

  const visibleRegion = useVisibleRegion(coordInstance, scrollState);

  const { selection, setSelection } = useSelection(
    coordInstance,
    setActiveCell,
    onSelectionChanged
  );

  const getRangeByPosition = (x: number, y: number) => {
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

    return [columnIndex, rowIndex];
  };

  // Highlight the clicked area to enhance the user experience
  const onTapStyleEffect = (mouseState: IMouseState) => {
    setMouseState(mouseState);
    setTimeout(() => setMouseState(DEFAULT_MOUSE_STATE), 500);
  };

  const onTap = (e: HammerInput) => {
    const pointerEvent = e.changedPointers[0];
    const x = pointerEvent?.offsetX ?? pointerEvent?.layerX;
    const y = pointerEvent?.offsetY ?? pointerEvent?.layerY;
    const [columnIndex, rowIndex] = getRangeByPosition(x, y);
    const posInfo = { x, y, rowIndex, columnIndex, isOutOfBounds: false };

    // Tap the column header
    if (rowIndex === -1 && columnIndex > -1) {
      onTapStyleEffect({ ...posInfo, type: RegionType.ColumnHeader });
      return onColumnHeaderClick?.(columnIndex, {
        x: coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft),
        y: 0,
        width: coordInstance.getColumnWidth(columnIndex),
        height: columnHeadHeight,
      });
    }

    // Tap the append column button
    if (hasAppendColumn && rowIndex >= -1 && columnIndex === -2) {
      onTapStyleEffect({ ...posInfo, type: RegionType.AppendColumn });
      return onColumnAppend?.();
    }

    // Tap the append row button
    if (hasAppendRow && rowIndex === rowCount - 1 && columnIndex >= -1) {
      onTapStyleEffect({ ...posInfo, type: RegionType.AppendRow });
      return onRowAppend?.();
    }

    // Tap the row
    if (rowIndex >= 0) {
      const range = [0, rowIndex];
      setActiveCell(range as IRange);
      setSelection(selection.set(SelectionRegionType.Cells, [range, range] as IRange[]));
      onTapStyleEffect({ ...posInfo, type: RegionType.Cell });
      onRowExpand?.(rowIndex);
    }
  };

  return (
    <ReactHammer onTap={onTap}>
      <div ref={containerRef} style={{ width, height }}>
        <RenderLayer
          theme={theme}
          width={width}
          height={height}
          columns={columns}
          columnStatistics={columnStatistics}
          coordInstance={coordInstance}
          rowControls={rowControls}
          imageManager={imageManager}
          spriteManager={spriteManager}
          visibleRegion={visibleRegion}
          activeCell={null}
          activeCellBound={null}
          mouseState={mouseState}
          scrollState={scrollState}
          dragState={DEFAULT_DRAG_STATE}
          selection={emptySelection}
          isSelecting={false}
          forceRenderFlag={forceRenderFlag}
          columnResizeState={DEFAULT_COLUMN_RESIZE_STATE}
          hoverCellPosition={null}
          hoveredColumnResizeIndex={-1}
          getCellContent={getCellContent}
          isRowAppendEnable={hasAppendRow}
          isColumnAppendEnable={hasAppendColumn}
        />
      </div>
    </ReactHammer>
  );
};
