/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import { useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { IGridTheme } from './configs';
import { GRID_DEFAULT, gridTheme, DEFAULT_SCROLL_STATE, DEFAULT_MOUSE_STATE } from './configs';
import { useEventListener, useResizeObserver } from './hooks';
import type { ScrollerRef } from './InfiniteScroller';
import { InfiniteScroller } from './InfiniteScroller';
import { InteractionLayer } from './InteractionLayer';
import { RegionType, RowControlType } from './interface';
import type {
  IRectangle,
  IScrollState,
  ISelectionState,
  ICellItem,
  IColumn,
  IMouseState,
} from './interface';
import type { ISpriteMap } from './managers';
import { CoordinateManager, SpriteManager, ImageManager } from './managers';
import type { ICell, IInnerCell } from './renderers';

export interface IGridExternalProps {
  theme?: Partial<IGridTheme>;
  headerIcons?: ISpriteMap;
  rowControls?: RowControlType[];
  smoothScrollX?: boolean;
  smoothScrollY?: boolean;
  onDelete?: (selectionState: ISelectionState) => void;
  onRowAppend?: () => void;
  onColumnAppend?: () => void;
  onCellEdited?: (cell: ICellItem, newValue: IInnerCell) => void;
  onVisibleRegionChanged?: (rect: IRectangle) => void;
  onCellActivated?: (cell: ICellItem) => void;
  onColumnOrdered?: (column: IColumn, colIndex: number, newOrder: number) => void;
  onColumnResize?: (
    column: IColumn,
    newSize: number,
    colIndex: number,
    newSizeWithGrow: number
  ) => void;
  onColumnHeaderMenuClick?: (colIndex: number, position: IRectangle) => void;
}

export interface IGridProps extends IGridExternalProps {
  columns: IColumn[];
  freezeColumnCount?: number;
  rowCount: number;
  rowHeight?: number;
  style?: CSSProperties;
  getCellContent: (cell: ICellItem) => ICell;
}

export interface IGridRef {
  getBounds: (colIndex: number, rowIndex: number) => IRectangle | null;
  forceUpdate: () => void;
}

const {
  scrollBuffer,
  columnAppendBtnWidth,
  rowHeight: defaultRowHeight,
  columnWidth: defaultColumnWidth,
  columnHeadHeight: defaultColumnHeaderHeight,
} = GRID_DEFAULT;

const GridBase: ForwardRefRenderFunction<IGridRef, IGridProps> = (props, forwardRef) => {
  const {
    columns,
    freezeColumnCount = 1,
    rowCount: originRowCount,
    rowHeight = defaultRowHeight,
    rowControls = [RowControlType.Checkbox],
    theme: customTheme,
    smoothScrollX,
    smoothScrollY,
    style,
    headerIcons,
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

  useImperativeHandle(forwardRef, () => ({
    getBounds: (colIndex: number, rowIndex: number) => {
      const { freezeColumnCount } = coordInstance;
      const { scrollTop, scrollLeft } = scrollState;
      const offsetX = coordInstance.getColumnOffset(colIndex);
      return {
        x: colIndex < freezeColumnCount ? offsetX : offsetX - scrollLeft,
        y: coordInstance.getRowOffset(rowIndex) - scrollTop,
        width: coordInstance.getColumnWidth(colIndex),
        height: coordInstance.getRowHeight(rowIndex),
      };
    },
    forceUpdate,
  }));

  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;
  const rowControlCount = rowControls.length;
  const rowCount = hasAppendRow ? originRowCount + 1 : originRowCount;
  const totalHeight = rowCount * rowHeight + scrollBuffer;
  const totalWidth = columns.reduce(
    (prev, column) => prev + (column.width || defaultColumnWidth),
    hasAppendColumn ? scrollBuffer + columnAppendBtnWidth : scrollBuffer
  );

  const [, forceUpdateInner] = useState(0);
  const [mouseState, setMouseState] = useState<IMouseState>(DEFAULT_MOUSE_STATE);
  const [scrollState, setScrollState] = useState<IScrollState>(DEFAULT_SCROLL_STATE);
  const scrollerRef = useRef<ScrollerRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { ref, width, height } = useResizeObserver<HTMLDivElement>();

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
      containerHeight: height,
      rowInitSize: defaultColumnHeaderHeight,
      columnInitSize: Math.max(rowControlCount, 2) * iconSizeMD,
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
    height,
    columns,
    rowCount,
    rowHeight,
    originRowCount,
    freezeColumnCount,
    rowControlCount,
    iconSizeMD,
  ]);

  const forceUpdate = useCallback(() => forceUpdateInner(Math.random()), []);

  const spriteManager = useMemo(
    () => new SpriteManager(headerIcons, () => forceUpdate()),
    [headerIcons, forceUpdate]
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

  const { rowInitSize, columnInitSize } = coordInstance;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        ...style,
      }}
      ref={ref}
    >
      <div ref={containerRef} tabIndex={0} className="relative outline-none">
        <InteractionLayer
          theme={theme}
          columns={columns}
          rowControls={rowControls}
          imageManager={imageManager}
          spriteManager={spriteManager}
          coordInstance={coordInstance}
          scrollState={scrollState}
          mouseState={mouseState}
          setMouseState={setMouseState}
          getCellContent={getCellContent}
          scrollTo={scrollTo}
          scrollBy={scrollBy}
          onDelete={onDelete}
          onRowAppend={onRowAppend}
          onCellEdited={onCellEdited}
          onCellActivated={onCellActivated}
          onColumnAppend={onColumnAppend}
          onColumnResize={onColumnResize}
          onColumnOrdered={onColumnOrdered}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
        />
      </div>

      <InfiniteScroller
        ref={scrollerRef}
        coordInstance={coordInstance}
        top={rowInitSize}
        left={columnInitSize}
        containerWidth={width}
        containerHeight={height}
        scrollWidth={totalWidth}
        scrollHeight={totalHeight}
        smoothScrollX={smoothScrollX}
        smoothScrollY={smoothScrollY}
        containerRef={containerRef}
        setScrollState={setScrollState}
        scrollEnable={mouseState.type !== RegionType.None}
      />
    </div>
  );
};

export const Grid = forwardRef(GridBase);
