/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import { useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { IGridTheme } from './configs';
import { GRID_DEFAULT, gridTheme, DEFAULT_SCROLL_STATE } from './configs';
import { useEventListener, useResizeObserver } from './hooks';
import type { ScrollerRef } from './InfiniteScroller';
import { InfiniteScroller } from './InfiniteScroller';
import { InteractionLayer } from './InteractionLayer';
import { RowControlType } from './interface';
import type { IRectangle, IScrollState, ISelectionState, ICellItem, IColumn } from './interface';
import type { ISpriteMap } from './managers';
import { CoordinateManager, SpriteManager } from './managers';
import type { IInnerCell } from './renderers';

export interface IGridExternalProps {
  readonly theme?: IGridTheme;
  readonly headerIcons?: ISpriteMap;
  readonly rowControls?: RowControlType[];
  readonly smoothScrollX?: boolean;
  readonly smoothScrollY?: boolean;
  readonly onDelete?: (selectionState: ISelectionState) => void;
  readonly onRowAppend?: () => void;
  readonly onCellEdited?: (cell: ICellItem, newValue: IInnerCell) => void;
  readonly onColumnAppend?: () => void;
  readonly onCellActivated?: (cell: ICellItem) => void;
  readonly onColumnOrdered?: (column: IColumn, colIndex: number, newOrder: number) => void;
  readonly onColumnResize?: (
    column: IColumn,
    newSize: number,
    colIndex: number,
    newSizeWithGrow: number
  ) => void;
  readonly onColumnHeaderMenuClick?: (colIndex: number, position: IRectangle) => void;
}

export interface IGridProps extends IGridExternalProps {
  readonly columns: IColumn[];
  readonly freezeColumnCount?: number;
  readonly rowCount: number;
  readonly rowHeight?: number;
  readonly style?: CSSProperties;
  readonly getCellContent: (cell: ICellItem) => IInnerCell;
}

export interface IGridRef {
  getBounds: (colIndex: number, rowIndex: number) => IRectangle | null;
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

  const [, forceUpdate] = useState(0);
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

  const spriteManager = useMemo(() => {
    return new SpriteManager(headerIcons, () => forceUpdate(Math.random()));
  }, [headerIcons]);

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
          coordInstance={coordInstance}
          scrollState={scrollState}
          spriteManager={spriteManager}
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
        totalWidth={totalWidth}
        totalHeight={totalHeight}
        smoothScrollX={smoothScrollX}
        smoothScrollY={smoothScrollY}
        containerRef={containerRef.current}
        setScrollState={setScrollState}
      />
    </div>
  );
};

export const Grid = forwardRef(GridBase);
