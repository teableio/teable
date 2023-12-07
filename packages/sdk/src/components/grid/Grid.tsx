/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-tabindex */
import { uniqueId } from 'lodash';
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import { useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { IGridTheme } from './configs';
import {
  GRID_DEFAULT,
  gridTheme,
  DEFAULT_SCROLL_STATE,
  DEFAULT_MOUSE_STATE,
  GRID_CONTAINER_ID,
} from './configs';
import { useResizeObserver } from './hooks';
import type { ScrollerRef } from './InfiniteScroller';
import { InfiniteScroller } from './InfiniteScroller';
import type { IInteractionLayerRef } from './InteractionLayer';
import { InteractionLayer } from './InteractionLayer';
import type {
  IRectangle,
  IScrollState,
  ICellItem,
  IGridColumn,
  IMouseState,
  IPosition,
  IRowControlItem,
  IColumnStatistics,
  ICollaborator,
  IActiveCellBound,
} from './interface';
import { RegionType, RowControlType, DraggableType, SelectableType } from './interface';
import type { ISpriteMap, CombinedSelection } from './managers';
import { CoordinateManager, SpriteManager, ImageManager } from './managers';
import type { ICell, IInnerCell } from './renderers';
import { TouchLayer } from './TouchLayer';

export interface IGridExternalProps {
  theme?: Partial<IGridTheme>;
  customIcons?: ISpriteMap;
  rowControls?: IRowControlItem[];
  smoothScrollX?: boolean;
  smoothScrollY?: boolean;
  scrollBufferX?: number;
  scrollBufferY?: number;
  rowCounterVisible?: boolean;
  rowIndexVisible?: boolean;
  collaborators?: ICollaborator;

  /**
   * Indicates which areas can be dragged, including rows, columns or no drag
   * - 'all': Allow drag of rows, columns and cells (default)
   * - 'none': Disable drag for all areas
   * - 'row': Allow row drag only
   * - 'column': Allow column drag only
   */
  draggable?: DraggableType;

  /**
   * Indicates which areas can be selected, including row selection,
   * column selection, cell selection, all areas, or no selection
   * - 'all': Allow selection of rows, columns and cells (default)
   * - 'none': Disable selection for all areas
   * - 'row': Allow row selection only
   * - 'column': Allow column selection only
   * - 'cell': Allow cell selection only
   */
  selectable?: SelectableType;

  /**
   * Whether to allow multiple selection operations, including rows, columns and cells
   * If true, allow multiple selection of rows/columns/cells (default)
   * If false, disable multiple selection operations
   * @type {boolean}
   */
  isMultiSelectionEnable?: boolean;

  onRowAppend?: () => void;
  onColumnAppend?: () => void;
  onCopy?: (selection: CombinedSelection) => void;
  onPaste?: (selection: CombinedSelection) => void;
  onDelete?: (selection: CombinedSelection) => void;
  onCellEdited?: (cell: ICellItem, newValue: IInnerCell) => void;
  onSelectionChanged?: (selection: CombinedSelection) => void;
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

  /**
   * Triggered when the mouse hovers over the every type of region
   */
  onItemHovered?: (type: RegionType, bounds: IRectangle, cellItem: ICellItem) => void;

  /**
   * Triggered when the mouse clicks the every type of region
   */
  onItemClick?: (type: RegionType, bounds: IRectangle, cellItem: ICellItem) => void;
}

export interface IGridProps extends IGridExternalProps {
  columns: IGridColumn[];
  freezeColumnCount?: number;
  rowCount: number;
  rowHeight?: number;
  style?: CSSProperties;
  isTouchDevice?: boolean;
  columnStatistics?: IColumnStatistics;
  getCellContent: (cell: ICellItem) => ICell;
}

export interface IGridRef {
  resetState: () => void;
  forceUpdate: () => void;
  setSelection: (selection: CombinedSelection) => void;
  scrollToItem: (position: [columnIndex: number, rowIndex: number]) => void;
}

const {
  appendRowHeight,
  cellScrollBuffer,
  columnAppendBtnWidth,
  columnStatisticHeight,
  rowHeight: defaultRowHeight,
  columnWidth: defaultColumnWidth,
  columnHeadHeight: defaultColumnHeaderHeight,
} = GRID_DEFAULT;

const GridBase: ForwardRefRenderFunction<IGridRef, IGridProps> = (props, forwardRef) => {
  const {
    columns,
    draggable = DraggableType.All,
    selectable = SelectableType.All,
    columnStatistics,
    freezeColumnCount = 1,
    rowCount: originRowCount,
    rowHeight = defaultRowHeight,
    rowControls = [{ type: RowControlType.Checkbox }],
    theme: customTheme,
    isTouchDevice,
    smoothScrollX,
    smoothScrollY,
    scrollBufferX = 100,
    scrollBufferY = 100,
    rowCounterVisible,
    rowIndexVisible = true,
    isMultiSelectionEnable = true,
    style,
    customIcons,
    collaborators,
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
    onSelectionChanged,
    onVisibleRegionChanged,
    onColumnHeaderClick,
    onColumnHeaderDblClick,
    onColumnHeaderMenuClick,
    onColumnStatisticClick,
    onItemHovered,
    onItemClick,
  } = props;

  useImperativeHandle(forwardRef, () => ({
    scrollToItem,
    resetState: () => interactionLayerRef.current?.resetState(),
    forceUpdate: () => setForceRenderFlag(uniqueId('grid_')),
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
    scrollBufferY;
  const totalWidth = columns.reduce(
    (prev, column) => prev + (column.width || defaultColumnWidth),
    hasAppendColumn ? scrollBufferX + columnAppendBtnWidth : scrollBufferX
  );

  const [forceRenderFlag, setForceRenderFlag] = useState(uniqueId('grid_'));
  const [mouseState, setMouseState] = useState<IMouseState>(DEFAULT_MOUSE_STATE);
  const [scrollState, setScrollState] = useState<IScrollState>(DEFAULT_SCROLL_STATE);
  const [activeCellBound, setActiveCellBound] = useState<IActiveCellBound | null>(null);
  const scrollerRef = useRef<ScrollerRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionLayerRef = useRef<IInteractionLayerRef | null>(null);
  const { ref, width, height } = useResizeObserver<HTMLDivElement>();

  const hoverRegionType = mouseState.type;
  const hasColumnStatistics = columnStatistics != null;
  const containerHeight = hasColumnStatistics ? height - columnStatisticHeight : height;
  const scrollEnable =
    hoverRegionType !== RegionType.None &&
    !(hoverRegionType === RegionType.ActiveCell && activeCellBound?.scrollEnable);

  const theme = useMemo(() => ({ ...gridTheme, ...customTheme }), [customTheme]);

  const { iconSizeMD } = theme;
  const coordInstance = useMemo<CoordinateManager>(() => {
    const columnInitSize =
      !rowIndexVisible && !rowControlCount ? 0 : Math.max(rowControlCount, 2) * iconSizeMD;

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
      columnInitSize,
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
    rowIndexVisible,
    hasAppendRow,
    iconSizeMD,
  ]);

  const spriteManager = useMemo(
    () => new SpriteManager(customIcons, () => setForceRenderFlag(uniqueId('grid_'))),
    [customIcons]
  );

  const imageManager = useMemo<ImageManager>(() => {
    const imgManager = new ImageManager();
    imgManager.setCallback(() => setForceRenderFlag(uniqueId('grid_')));
    return imgManager;
  }, []);

  const scrollTo = useCallback((sl?: number, st?: number) => {
    scrollerRef.current?.scrollTo(sl, st);
  }, []);

  const scrollBy = useCallback((deltaX: number, deltaY: number) => {
    scrollerRef.current?.scrollBy(deltaX, deltaY);
  }, []);

  const scrollToItem = useCallback(
    (position: [columnIndex: number, rowIndex: number]) => {
      const { containerHeight, containerWidth, freezeRegionWidth, freezeColumnCount, rowInitSize } =
        coordInstance;
      const { scrollTop, scrollLeft } = scrollState;
      const [columnIndex, rowIndex] = position;
      const isFreezeColumn = columnIndex < freezeColumnCount;

      if (!isFreezeColumn) {
        const offsetX = coordInstance.getColumnOffset(columnIndex);
        const columnWidth = coordInstance.getColumnWidth(columnIndex);
        const deltaLeft = Math.min(offsetX - scrollLeft - freezeRegionWidth, 0);
        const deltaRight = Math.max(offsetX + columnWidth - scrollLeft - containerWidth, 0);
        const sl = scrollLeft + deltaLeft + deltaRight;
        if (sl !== scrollLeft) {
          const scrollBuffer =
            deltaLeft < 0 ? -cellScrollBuffer : deltaRight > 0 ? cellScrollBuffer : 0;
          scrollTo(sl + scrollBuffer, undefined);
        }
      }

      const rowHeight = coordInstance.getRowHeight(rowIndex);
      const offsetY = coordInstance.getRowOffset(rowIndex);
      const deltaTop = Math.min(offsetY - scrollTop - rowInitSize, 0);
      const deltaBottom = Math.max(offsetY + rowHeight - scrollTop - containerHeight, 0);
      const st = scrollTop + deltaTop + deltaBottom;
      if (st !== scrollTop) {
        scrollTo(undefined, st);
      }
    },
    [coordInstance, scrollState, scrollTo]
  );

  const onMouseDown = () => {
    containerRef.current?.focus();
  };

  const { rowInitSize, columnInitSize } = coordInstance;

  return (
    <div className="h-full w-full" style={style} ref={ref}>
      <div
        id={GRID_CONTAINER_ID}
        ref={containerRef}
        tabIndex={0}
        className="relative outline-none"
        onMouseDown={onMouseDown}
      >
        {isTouchDevice ? (
          <TouchLayer
            width={width}
            height={height}
            theme={theme}
            columns={columns}
            mouseState={mouseState}
            scrollState={scrollState}
            rowControls={rowControls}
            imageManager={imageManager}
            spriteManager={spriteManager}
            coordInstance={coordInstance}
            columnStatistics={columnStatistics}
            getCellContent={getCellContent}
            forceRenderFlag={forceRenderFlag}
            setMouseState={setMouseState}
            onDelete={onDelete}
            onRowAppend={onRowAppend}
            onRowExpand={onRowExpand}
            onCellEdited={onCellEdited}
            onCellActivated={onCellActivated}
            onSelectionChanged={onSelectionChanged}
            onContextMenu={onContextMenu}
            onColumnAppend={onColumnAppend}
            onColumnHeaderClick={onColumnHeaderClick}
            onColumnStatisticClick={onColumnStatisticClick}
          />
        ) : (
          <InteractionLayer
            ref={interactionLayerRef}
            width={width}
            height={height}
            theme={theme}
            columns={columns}
            draggable={draggable}
            selectable={selectable}
            collaborators={collaborators}
            rowControls={rowControls}
            imageManager={imageManager}
            spriteManager={spriteManager}
            coordInstance={coordInstance}
            columnStatistics={columnStatistics}
            isMultiSelectionEnable={isMultiSelectionEnable}
            mouseState={mouseState}
            scrollState={scrollState}
            setMouseState={setMouseState}
            getCellContent={getCellContent}
            forceRenderFlag={forceRenderFlag}
            rowCounterVisible={rowCounterVisible}
            rowIndexVisible={rowIndexVisible}
            activeCellBound={activeCellBound}
            setActiveCellBound={setActiveCellBound}
            scrollToItem={scrollToItem}
            scrollBy={scrollBy}
            onCopy={onCopy}
            onPaste={onPaste}
            onDelete={onDelete}
            onRowAppend={onRowAppend}
            onRowExpand={onRowExpand}
            onRowOrdered={onRowOrdered}
            onCellEdited={onCellEdited}
            onCellActivated={onCellActivated}
            onSelectionChanged={onSelectionChanged}
            onContextMenu={onContextMenu}
            onColumnAppend={onColumnAppend}
            onColumnResize={onColumnResize}
            onColumnOrdered={onColumnOrdered}
            onColumnHeaderClick={onColumnHeaderClick}
            onColumnHeaderDblClick={onColumnHeaderDblClick}
            onColumnHeaderMenuClick={onColumnHeaderMenuClick}
            onColumnStatisticClick={onColumnStatisticClick}
            onItemHovered={onItemHovered}
            onItemClick={onItemClick}
          />
        )}
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
        scrollState={scrollState}
        setScrollState={setScrollState}
        scrollEnable={scrollEnable}
        onVisibleRegionChanged={onVisibleRegionChanged}
      />
    </div>
  );
};

export const Grid = forwardRef(GridBase);
