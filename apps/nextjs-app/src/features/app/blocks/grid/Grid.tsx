/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import { useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useClickAway, useUpdate } from 'react-use';
import type { IGridTheme } from './configs';
import { GRID_DEFAULT, gridTheme, DEFAULT_SCROLL_STATE, DEFAULT_MOUSE_STATE } from './configs';
import { useEventListener, useResizeObserver } from './hooks';
import type { ScrollerRef } from './InfiniteScroller';
import { InfiniteScroller } from './InfiniteScroller';
import type { IInteractionLayerRef } from './InteractionLayer';
import { InteractionLayer } from './InteractionLayer';
import { RegionType, RowControlType } from './interface';
import type {
  IRectangle,
  IScrollState,
  ICellItem,
  IGridColumn,
  IMouseState,
  IPosition,
  IRowControlItem,
  IColumnStatistics,
} from './interface';
import type { ISpriteMap, CombinedSelection } from './managers';
import { CoordinateManager, SpriteManager, ImageManager } from './managers';
import type { ICell, IInnerCell } from './renderers';

export interface IGridExternalProps {
  theme?: Partial<IGridTheme>;
  customIcons?: ISpriteMap;
  rowControls?: IRowControlItem[];
  smoothScrollX?: boolean;
  smoothScrollY?: boolean;
  onRowAppend?: () => void;
  onColumnAppend?: () => void;
  onCopy?: (selection: CombinedSelection) => void;
  onPaste?: (selection: CombinedSelection) => void;
  onDelete?: (selection: CombinedSelection) => void;
  onCellEdited?: (cell: ICellItem, newValue: IInnerCell) => void;
  onVisibleRegionChanged?: (rect: IRectangle) => void;
  onCellActivated?: (cell: ICellItem) => void;
  onRowExpand?: (rowIndex: number) => void;
  onRowOrdered?: (dragRowIndexCollection: number[], dropRowIndex: number) => void;
  onColumnOrdered?: (dragColIndexCollection: number[], dropColIndex: number) => void;
  onColumnResize?: (column: IGridColumn, newSize: number, colIndex: number) => void;
  onColumnHeaderClick?: (colIndex: number, bounds: IRectangle) => void;
  onColumnHeaderDblClick?: (colIndex: number, bounds: IRectangle) => void;
  onColumnHeaderMenuClick?: (colIndex: number, bounds: IRectangle) => void;
  onColumnStatisticClick?: (colIndex: number, bounds: IRectangle) => void;
  onContextMenu?: (selection: CombinedSelection, position: IPosition) => void;
}

export interface IGridProps extends IGridExternalProps {
  columns: IGridColumn[];
  freezeColumnCount?: number;
  rowCount: number;
  rowHeight?: number;
  style?: CSSProperties;
  columnStatistics?: IColumnStatistics;
  getCellContent: (cell: ICellItem) => ICell;
}

export interface IGridRef {
  getBounds: (colIndex: number, rowIndex: number) => IRectangle | null;
  forceUpdate: () => void;
}

const {
  scrollBuffer,
  appendRowHeight,
  columnAppendBtnWidth,
  columnStatisticHeight,
  rowHeight: defaultRowHeight,
  columnWidth: defaultColumnWidth,
  columnHeadHeight: defaultColumnHeaderHeight,
} = GRID_DEFAULT;

const GridBase: ForwardRefRenderFunction<IGridRef, IGridProps> = (props, forwardRef) => {
  const {
    columns,
    columnStatistics,
    freezeColumnCount = 1,
    rowCount: originRowCount,
    rowHeight = defaultRowHeight,
    rowControls = [{ type: RowControlType.Checkbox }],
    theme: customTheme,
    smoothScrollX,
    smoothScrollY,
    style,
    customIcons,
    getCellContent,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    onRowExpand,
    onRowOrdered,
    onCellEdited,
    onCellActivated,
    onColumnAppend,
    onColumnResize,
    onColumnOrdered,
    onContextMenu,
    onVisibleRegionChanged,
    onColumnHeaderClick,
    onColumnHeaderDblClick,
    onColumnHeaderMenuClick,
    onColumnStatisticClick,
  } = props;

  useImperativeHandle(forwardRef, () => ({
    getBounds: (colIndex: number, rowIndex: number) => {
      const { scrollTop, scrollLeft } = scrollState;
      return {
        x: coordInstance.getColumnRelativeOffset(colIndex, scrollLeft),
        y: coordInstance.getRowOffset(rowIndex) - scrollTop,
        width: coordInstance.getColumnWidth(colIndex),
        height: coordInstance.getRowHeight(rowIndex),
      };
    },
    forceUpdate,
    setSelection: (selection: CombinedSelection) => {
      interactionLayerRef.current?.setSelection(selection);
    },
  }));

  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;
  const rowControlCount = rowControls.length;
  const rowCount = hasAppendRow ? originRowCount + 1 : originRowCount;
  const totalHeight =
    (hasAppendRow ? (rowCount - 1) * rowHeight + appendRowHeight : rowCount * rowHeight) +
    scrollBuffer;
  const totalWidth = columns.reduce(
    (prev, column) => prev + (column.width || defaultColumnWidth),
    hasAppendColumn ? scrollBuffer + columnAppendBtnWidth : scrollBuffer
  );

  const forceUpdate = useUpdate();
  const [mouseState, setMouseState] = useState<IMouseState>(DEFAULT_MOUSE_STATE);
  const [scrollState, setScrollState] = useState<IScrollState>(DEFAULT_SCROLL_STATE);
  const scrollerRef = useRef<ScrollerRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionLayerRef = useRef<IInteractionLayerRef | null>(null);
  const { ref, width, height } = useResizeObserver<HTMLDivElement>();
  const hasColumnStatistics = columnStatistics != null;
  const containerHeight = hasColumnStatistics ? height - columnStatisticHeight : height;

  const theme = useMemo(() => ({ ...gridTheme, ...customTheme }), [customTheme]);

  const { iconSizeMD } = theme;
  const coordInstance = useMemo<CoordinateManager>(() => {
    return new CoordinateManager({
      rowHeight,
      columnWidth: defaultColumnWidth,
      pureRowCount: originRowCount,
      rowCount,
      columnCount: columns.length,
      freezeColumnCount,
      containerWidth: width,
      containerHeight,
      rowInitSize: defaultColumnHeaderHeight,
      columnInitSize: Math.max(rowControlCount, 2) * iconSizeMD,
      rowHeightMap: hasAppendRow ? { [rowCount - 1]: appendRowHeight } : undefined,
      columnWidthMap: columns.reduce(
        (acc, column, index) => ({
          ...acc,
          [index]: column.width || defaultColumnWidth,
        }),
        {}
      ),
    });
  }, [
    width,
    containerHeight,
    columns,
    rowCount,
    rowHeight,
    originRowCount,
    freezeColumnCount,
    rowControlCount,
    hasAppendRow,
    iconSizeMD,
  ]);

  const spriteManager = useMemo(
    () => new SpriteManager(customIcons, () => forceUpdate()),
    [customIcons, forceUpdate]
  );

  const imageManager = useMemo<ImageManager>(() => new ImageManager(), []);

  const scrollTo = useCallback((sl?: number, st?: number) => {
    scrollerRef.current?.scrollTo(sl, st);
  }, []);

  const scrollBy = useCallback((deltaX: number, deltaY: number) => {
    scrollerRef.current?.scrollBy(deltaX, deltaY);
  }, []);

  const onMouseDown = useCallback(() => {
    containerRef.current?.focus();
  }, []);

  useEventListener('mousedown', onMouseDown, containerRef.current, true);

  useClickAway(ref, () => {
    interactionLayerRef.current?.onReset();
  });

  const { rowInitSize, columnInitSize } = coordInstance;

  return (
    <div className="w-full h-full" style={style} ref={ref}>
      <div ref={containerRef} tabIndex={0} className="relative outline-none">
        <InteractionLayer
          ref={interactionLayerRef}
          width={width}
          height={height}
          theme={theme}
          columns={columns}
          rowControls={rowControls}
          imageManager={imageManager}
          spriteManager={spriteManager}
          coordInstance={coordInstance}
          columnStatistics={columnStatistics}
          scrollState={scrollState}
          mouseState={mouseState}
          setMouseState={setMouseState}
          getCellContent={getCellContent}
          scrollTo={scrollTo}
          scrollBy={scrollBy}
          onCopy={onCopy}
          onPaste={onPaste}
          onDelete={onDelete}
          onRowAppend={onRowAppend}
          onRowExpand={onRowExpand}
          onRowOrdered={onRowOrdered}
          onCellEdited={onCellEdited}
          onCellActivated={onCellActivated}
          onContextMenu={onContextMenu}
          onColumnAppend={onColumnAppend}
          onColumnResize={onColumnResize}
          onColumnOrdered={onColumnOrdered}
          onColumnHeaderClick={onColumnHeaderClick}
          onColumnHeaderDblClick={onColumnHeaderDblClick}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
          onColumnStatisticClick={onColumnStatisticClick}
        />
      </div>

      <InfiniteScroller
        ref={scrollerRef}
        coordInstance={coordInstance}
        top={rowInitSize}
        left={columnInitSize}
        containerWidth={width}
        containerHeight={containerHeight}
        scrollWidth={totalWidth}
        scrollHeight={totalHeight}
        smoothScrollX={smoothScrollX}
        smoothScrollY={smoothScrollY}
        containerRef={containerRef}
        setScrollState={setScrollState}
        scrollEnable={mouseState.type !== RegionType.None}
        onVisibleRegionChanged={onVisibleRegionChanged}
      />
    </div>
  );
};

export const Grid = forwardRef(GridBase);
