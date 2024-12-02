/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-tabindex */
import { uniqueId } from 'lodash';
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import { useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useRafState } from 'react-use';
import type { IGridTheme } from './configs';
import {
  gridTheme,
  GRID_DEFAULT,
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
  IGroupPoint,
  ILinearRow,
  IGroupCollection,
  DragRegionType,
} from './interface';
import {
  RegionType,
  RowControlType,
  DraggableType,
  SelectableType,
  LinearRowType,
} from './interface';
import type { ISpriteMap, CombinedSelection, IIndicesMap } from './managers';
import { CoordinateManager, SpriteManager, ImageManager } from './managers';
import { getCellRenderer, type ICell, type IInnerCell } from './renderers';
import { TouchLayer } from './TouchLayer';
import { measuredCanvas } from './utils';

export interface IGridExternalProps {
  theme?: Partial<IGridTheme>;
  customIcons?: ISpriteMap;
  rowControls?: IRowControlItem[];
  smoothScrollX?: boolean;
  smoothScrollY?: boolean;
  scrollBufferX?: number;
  scrollBufferY?: number;
  scrollBarVisible?: boolean;
  rowIndexVisible?: boolean;
  collaborators?: ICollaborator;
  // [rowIndex, colIndex]
  searchCursor?: [number, number] | null;
  searchHitIndex?: { fieldId: string; recordId: string }[];

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

  groupCollection?: IGroupCollection | null;
  collapsedGroupIds?: Set<string> | null;
  groupPoints?: IGroupPoint[] | null;

  onUndo?: () => void;
  onRedo?: () => void;
  onCopy?: (selection: CombinedSelection, e: React.ClipboardEvent) => void;
  onPaste?: (selection: CombinedSelection, e: React.ClipboardEvent) => void;
  onDelete?: (selection: CombinedSelection) => void;
  onCellEdited?: (cell: ICellItem, newValue: IInnerCell) => void;
  onSelectionChanged?: (selection: CombinedSelection) => void;
  onVisibleRegionChanged?: (rect: IRectangle) => void;
  onCollapsedGroupChanged?: (collapsedGroupIds: Set<string>) => void;
  onColumnFreeze?: (freezeColumnCount: number) => void;
  onColumnAppend?: () => void;
  onRowExpand?: (rowIndex: number) => void;
  onRowAppend?: (targetIndex?: number) => void;
  onRowOrdered?: (dragRowIndexCollection: number[], dropRowIndex: number) => void;
  onColumnOrdered?: (dragColIndexCollection: number[], dropColIndex: number) => void;
  onColumnResize?: (column: IGridColumn, newSize: number, colIndex: number) => void;
  onColumnHeaderClick?: (colIndex: number, bounds: IRectangle) => void;
  onColumnHeaderDblClick?: (colIndex: number, bounds: IRectangle) => void;
  onColumnHeaderMenuClick?: (colIndex: number, bounds: IRectangle) => void;
  onColumnStatisticClick?: (colIndex: number, bounds: IRectangle) => void;
  onContextMenu?: (selection: CombinedSelection, position: IPosition) => void;
  onScrollChanged?: (scrollLeft: number, scrollTop: number) => void;
  onDragStart?: (type: DragRegionType, dragIndexs: number[]) => void;

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
  commentCountMap?: Record<string, number>;
  freezeColumnCount?: number;
  rowCount: number;
  rowHeight?: number;
  style?: CSSProperties;
  isTouchDevice?: boolean;
  columnHeaderVisible?: boolean;
  columnStatistics?: IColumnStatistics;
  getCellContent: (cell: ICellItem) => ICell;
}

export interface IGridRef {
  resetState: () => void;
  forceUpdate: () => void;
  getActiveCell: () => ICellItem | null;
  getRowOffset: (rowIndex: number) => number;
  setSelection: (selection: CombinedSelection) => void;
  getScrollState: () => IScrollState;
  scrollBy: (deltaX: number, deltaY: number) => void;
  scrollTo: (scrollLeft?: number, scrollTop?: number) => void;
  scrollToItem: (position: [columnIndex: number, rowIndex: number]) => void;
}

const {
  scrollBuffer,
  appendRowHeight,
  groupHeaderHeight,
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
    commentCountMap,
    groupCollection,
    collapsedGroupIds,
    draggable = DraggableType.All,
    selectable = SelectableType.All,
    columnStatistics,
    freezeColumnCount: _freezeColumnCount = 1,
    rowCount: originRowCount,
    rowHeight = defaultRowHeight,
    rowControls = [{ type: RowControlType.Checkbox }],
    theme: customTheme,
    isTouchDevice,
    smoothScrollX = true,
    smoothScrollY = true,
    scrollBufferX = scrollBuffer,
    scrollBufferY = scrollBuffer,
    scrollBarVisible = true,
    rowIndexVisible = true,
    isMultiSelectionEnable = true,
    style,
    customIcons,
    collaborators,
    searchCursor,
    searchHitIndex,
    groupPoints,
    columnHeaderVisible = true,
    getCellContent,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    onRowExpand,
    onRowOrdered,
    onCellEdited,
    onColumnAppend,
    onColumnResize,
    onColumnOrdered,
    onDragStart,
    onContextMenu,
    onSelectionChanged,
    onVisibleRegionChanged,
    onColumnFreeze,
    onColumnHeaderClick,
    onColumnHeaderDblClick,
    onColumnHeaderMenuClick,
    onColumnStatisticClick,
    onCollapsedGroupChanged,
    onItemHovered,
    onItemClick,
    onScrollChanged,
  } = props;

  useImperativeHandle(forwardRef, () => ({
    resetState: () => interactionLayerRef.current?.resetState(),
    forceUpdate: () => setForceRenderFlag(uniqueId('grid_')),
    getActiveCell: () => activeCell,
    setSelection: (selection: CombinedSelection) => {
      interactionLayerRef.current?.setSelection(selection);
    },
    getRowOffset: (rowIndex: number) => {
      const { scrollTop } = scrollState;
      const realRowIndex = real2RowIndex(rowIndex);
      return coordInstance.getRowOffset(realRowIndex) - scrollTop;
    },
    scrollBy,
    scrollTo,
    scrollToItem,
    getScrollState: () => scrollState,
  }));

  const hasAppendRow = onRowAppend != null;
  const hasAppendColumn = onColumnAppend != null;
  const rowControlCount = rowControls.length;
  const totalWidth = columns.reduce(
    (prev, column) => prev + (column.width || defaultColumnWidth),
    hasAppendColumn ? scrollBufferX + columnAppendBtnWidth : scrollBufferX
  );

  const [forceRenderFlag, setForceRenderFlag] = useState(uniqueId('grid_'));
  const [mouseState, setMouseState] = useState<IMouseState>(DEFAULT_MOUSE_STATE);
  const [scrollState, setScrollState] = useState<IScrollState>(DEFAULT_SCROLL_STATE);
  const [activeCell, setActiveCell] = useRafState<ICellItem | null>(null);
  const scrollerRef = useRef<ScrollerRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionLayerRef = useRef<IInteractionLayerRef | null>(null);
  const { ref, width, height } = useResizeObserver<HTMLDivElement>();

  const [activeColumnIndex, activeRowIndex] = activeCell ?? [];
  const hoverRegionType = mouseState.type;
  const hasColumnStatistics = columnStatistics != null;
  const containerHeight = hasColumnStatistics ? height - columnStatisticHeight : height;
  const columnCount = columns.length;
  const freezeColumnCount = Math.min(_freezeColumnCount, columnCount);

  const theme = useMemo(() => ({ ...gridTheme, ...customTheme }), [customTheme]);
  const { iconSizeMD } = theme;

  const columnInitSize = useMemo(() => {
    return !rowIndexVisible && !rowControlCount ? 0 : Math.max(rowControlCount, 2) * iconSizeMD;
  }, [rowControlCount, rowIndexVisible, iconSizeMD]);

  const defaultRowsInfo = useMemo(() => {
    return {
      linearRows: [],
      real2LinearRowMap: null,
      pureRowCount: originRowCount,
      rowCount: hasAppendRow ? originRowCount + 1 : originRowCount,
      rowHeightMap: hasAppendRow ? { [originRowCount]: appendRowHeight } : undefined,
    };
  }, [hasAppendRow, originRowCount]);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const groupRowsInfo = useMemo(() => {
    if (!groupPoints?.length) return null;
    let rowIndex = 0;
    let totalIndex = 0;
    let currentValue: unknown = null;
    let collapsedDepth = Number.MAX_VALUE;
    const linearRows: ILinearRow[] = [];
    const rowHeightMap: IIndicesMap = {};
    const real2LinearRowMap: Record<number, number> = {};

    groupPoints.forEach((point) => {
      const { type } = point;
      if (type === LinearRowType.Group) {
        const { id, value, depth, isCollapsed } = point;
        const isSubGroup = depth > collapsedDepth;

        if (isCollapsed) {
          collapsedDepth = Math.min(collapsedDepth, depth);
          if (isSubGroup) return;
        } else if (!isSubGroup) {
          collapsedDepth = Number.MAX_VALUE;
        } else {
          return;
        }

        rowHeightMap[totalIndex] = groupHeaderHeight;
        linearRows.push({
          id,
          type: LinearRowType.Group,
          depth,
          value,
          realIndex: rowIndex,
          isCollapsed: Boolean(isCollapsed),
        });
        currentValue = value;
        totalIndex++;
      }
      if (type === LinearRowType.Row) {
        const count = point.count;

        for (let i = 0; i < count; i++) {
          real2LinearRowMap[rowIndex + i] = totalIndex + i;
          linearRows.push({
            type: LinearRowType.Row,
            displayIndex: i + 1,
            realIndex: rowIndex + i,
          });
        }

        rowIndex += count;
        totalIndex += count;

        if (hasAppendRow) {
          rowHeightMap[totalIndex] = appendRowHeight;
          linearRows.push({
            type: LinearRowType.Append,
            value: currentValue,
            realIndex: rowIndex - 1,
          });
          totalIndex++;
        }
      }
    });

    return {
      linearRows,
      real2LinearRowMap,
      pureRowCount: rowIndex,
      rowCount: totalIndex,
      rowHeightMap,
    };
  }, [groupPoints, hasAppendRow]);

  const { rowCount, pureRowCount, rowHeightMap, linearRows, real2LinearRowMap } = useMemo(() => {
    return { ...defaultRowsInfo, ...groupRowsInfo };
  }, [defaultRowsInfo, groupRowsInfo]);

  const getLinearRow = useCallback(
    (index: number) => {
      if (!linearRows.length) {
        return (
          index >= pureRowCount
            ? {
                type: LinearRowType.Append,
                realIndex: index - 1,
                value: null,
              }
            : {
                type: LinearRowType.Row,
                displayIndex: index + 1,
                realIndex: index,
              }
        ) as ILinearRow;
      }
      return linearRows[index] ?? { realIndex: -2 };
    },
    [linearRows, pureRowCount]
  );

  const real2RowIndex = useCallback(
    (index: number) => {
      if (real2LinearRowMap == null) return index;
      return real2LinearRowMap[index];
    },
    [real2LinearRowMap]
  );

  const columnWidthMap = useMemo(() => {
    return columns.reduce(
      (acc, column, index) => ({
        ...acc,
        [index]: column.width || defaultColumnWidth,
      }),
      {}
    );
  }, [columns]);

  const coordInstance = useMemo<CoordinateManager>(() => {
    return new CoordinateManager({
      rowHeight,
      columnWidth: defaultColumnWidth,
      pureRowCount,
      rowCount,
      columnCount,
      freezeColumnCount,
      containerWidth: width,
      containerHeight,
      rowInitSize: columnHeaderVisible ? defaultColumnHeaderHeight : 0,
      columnInitSize,
      rowHeightMap,
      columnWidthMap,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight, pureRowCount, rowCount, rowHeightMap, columnHeaderVisible]);

  const totalHeight = coordInstance.totalHeight + scrollBufferY;

  useMemo(() => {
    coordInstance.refreshColumnDimensions({ columnInitSize, columnCount, columnWidthMap });
    setForceRenderFlag(uniqueId('grid_'));
  }, [coordInstance, columnInitSize, columnCount, columnWidthMap]);

  useMemo(() => {
    coordInstance.containerWidth = width;
    coordInstance.containerHeight = containerHeight;
    coordInstance.freezeColumnCount = freezeColumnCount;
    setForceRenderFlag(uniqueId('grid_'));
  }, [coordInstance, width, containerHeight, freezeColumnCount]);

  const activeCellBound = useMemo(() => {
    if (activeColumnIndex == null || activeRowIndex == null) {
      return null;
    }

    const cell = getCellContent([activeColumnIndex, activeRowIndex]);
    const cellRenderer = getCellRenderer(cell.type);
    const originWidth = coordInstance.getColumnWidth(activeColumnIndex);
    const originHeight = coordInstance.getRowHeight(real2RowIndex(activeRowIndex));

    if (cellRenderer?.measure && measuredCanvas?.ctx != null) {
      const { width, height, totalHeight } = cellRenderer.measure(cell as never, {
        theme,
        ctx: measuredCanvas.ctx,
        width: originWidth,
        height: originHeight,
      });
      return {
        rowIndex: activeRowIndex,
        columnIndex: activeColumnIndex,
        width,
        height,
        totalHeight,
        scrollTop: 0,
        scrollEnable: totalHeight > height,
      };
    }
    return {
      rowIndex: activeRowIndex,
      columnIndex: activeColumnIndex,
      width: originWidth,
      height: originHeight,
      totalHeight: originHeight,
      scrollTop: 0,
      scrollEnable: false,
    };
  }, [activeColumnIndex, activeRowIndex, coordInstance, theme, getCellContent, real2RowIndex]);

  const scrollEnable =
    hoverRegionType !== RegionType.None &&
    !(hoverRegionType === RegionType.ActiveCell && activeCellBound?.scrollEnable);

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
      const [columnIndex, _rowIndex] = position;
      const rowIndex = real2RowIndex(_rowIndex);
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
    [coordInstance, scrollState, scrollTo, real2RowIndex]
  );

  const onMouseDown = () => {
    containerRef.current?.focus();
  };

  const { rowInitSize } = coordInstance;

  return (
    <div className="size-full" style={style} ref={ref}>
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
            commentCountMap={commentCountMap}
            mouseState={mouseState}
            scrollState={scrollState}
            rowControls={rowControls}
            collaborators={collaborators}
            searchCursor={searchCursor}
            searchHitIndex={searchHitIndex}
            imageManager={imageManager}
            spriteManager={spriteManager}
            coordInstance={coordInstance}
            columnStatistics={columnStatistics}
            collapsedGroupIds={collapsedGroupIds}
            columnHeaderVisible={columnHeaderVisible}
            forceRenderFlag={forceRenderFlag}
            rowIndexVisible={rowIndexVisible}
            groupCollection={groupCollection}
            getLinearRow={getLinearRow}
            real2RowIndex={real2RowIndex}
            getCellContent={getCellContent}
            setMouseState={setMouseState}
            setActiveCell={setActiveCell}
            onDelete={onDelete}
            onRowAppend={onRowAppend}
            onRowExpand={onRowExpand}
            onCellEdited={onCellEdited}
            onContextMenu={onContextMenu}
            onColumnAppend={onColumnAppend}
            onColumnHeaderClick={onColumnHeaderClick}
            onColumnStatisticClick={onColumnStatisticClick}
            onCollapsedGroupChanged={onCollapsedGroupChanged}
            onSelectionChanged={onSelectionChanged}
          />
        ) : (
          <InteractionLayer
            ref={interactionLayerRef}
            width={width}
            height={height}
            theme={theme}
            columns={columns}
            commentCountMap={commentCountMap}
            draggable={draggable}
            selectable={selectable}
            collaborators={collaborators}
            searchCursor={searchCursor}
            searchHitIndex={searchHitIndex}
            rowControls={rowControls}
            imageManager={imageManager}
            spriteManager={spriteManager}
            coordInstance={coordInstance}
            columnStatistics={columnStatistics}
            collapsedGroupIds={collapsedGroupIds}
            columnHeaderVisible={columnHeaderVisible}
            isMultiSelectionEnable={isMultiSelectionEnable}
            activeCell={activeCell}
            mouseState={mouseState}
            scrollState={scrollState}
            activeCellBound={activeCellBound}
            forceRenderFlag={forceRenderFlag}
            rowIndexVisible={rowIndexVisible}
            groupCollection={groupCollection}
            getLinearRow={getLinearRow}
            real2RowIndex={real2RowIndex}
            getCellContent={getCellContent}
            setMouseState={setMouseState}
            setActiveCell={setActiveCell}
            scrollToItem={scrollToItem}
            scrollBy={scrollBy}
            onUndo={onUndo}
            onRedo={onRedo}
            onCopy={onCopy}
            onPaste={onPaste}
            onDelete={onDelete}
            onDragStart={onDragStart}
            onRowAppend={onRowAppend}
            onRowExpand={onRowExpand}
            onRowOrdered={onRowOrdered}
            onCellEdited={onCellEdited}
            onContextMenu={onContextMenu}
            onColumnAppend={onColumnAppend}
            onColumnResize={onColumnResize}
            onColumnOrdered={onColumnOrdered}
            onColumnHeaderClick={onColumnHeaderClick}
            onColumnStatisticClick={onColumnStatisticClick}
            onColumnHeaderDblClick={onColumnHeaderDblClick}
            onColumnHeaderMenuClick={onColumnHeaderMenuClick}
            onCollapsedGroupChanged={onCollapsedGroupChanged}
            onSelectionChanged={onSelectionChanged}
            onColumnFreeze={onColumnFreeze}
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
        scrollBarVisible={scrollBarVisible}
        containerRef={containerRef}
        scrollState={scrollState}
        scrollEnable={scrollEnable}
        getLinearRow={getLinearRow}
        setScrollState={setScrollState}
        onScrollChanged={onScrollChanged}
        onVisibleRegionChanged={onVisibleRegionChanged}
      />
    </div>
  );
};

export const Grid = forwardRef(GridBase);
