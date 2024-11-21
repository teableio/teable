import { contractColorForTheme } from '@teable/core';
import { isEqual, groupBy, cloneDeep } from 'lodash';
import type { IGridTheme } from '../../configs';
import { GRID_DEFAULT, ROW_RELATED_REGIONS } from '../../configs';
import type { IVisibleRegion } from '../../hooks';
import { getDropTargetIndex } from '../../hooks';
import type { ICellItem, ICell, IRectangle, ICollaborator, ILinearRow } from '../../interface';
import { DragRegionType, LinearRowType, RegionType, RowControlType } from '../../interface';
import { GridInnerIcon } from '../../managers';
import {
  checkIfRowOrCellActive,
  checkIfRowOrCellSelected,
  calculateMaxRange,
  hexToRGBA,
} from '../../utils';
import type { ISingleLineTextProps } from '../base-renderer';
import {
  drawCheckbox,
  drawLine,
  drawRect,
  drawRoundPoly,
  drawSingleLineText,
} from '../base-renderer';
import { getCellRenderer, getCellScrollState } from '../cell-renderer';
import type {
  ICacheDrawerProps,
  ICellDrawerProps,
  IGroupRowDrawerProps,
  IFieldHeadDrawerProps,
  IGridHeaderDrawerProps,
  ILayoutDrawerProps,
  IRowHeaderDrawerProps,
  IGroupRowHeaderDrawerProps,
  IAppendRowDrawerProps,
  IGroupStatisticDrawerProps,
} from './interface';
import { RenderRegion, DividerRegion } from './interface';

const spriteIconMap = {
  [RowControlType.Drag]: GridInnerIcon.Drag,
  [RowControlType.Expand]: GridInnerIcon.Detail,
};

const {
  fillHandlerSize,
  rowHeadIconPaddingTop,
  columnStatisticHeight,
  columnHeadHeight,
  columnHeadPadding,
  columnHeadMenuSize,
  columnAppendBtnWidth,
  columnResizeHandlerWidth,
  columnResizeHandlerPaddingTop,
  cellScrollBarWidth,
  cellScrollBarPaddingX,
  cellScrollBarPaddingY,
  cellVerticalPaddingSM,
  cellVerticalPaddingMD,
  cellHorizontalPadding,
  columnFreezeHandlerWidth,
  columnFreezeHandlerHeight,
} = GRID_DEFAULT;

export const drawCellContent = (ctx: CanvasRenderingContext2D, props: ICellDrawerProps) => {
  const {
    x,
    y,
    width,
    height,
    theme,
    rowIndex,
    columnIndex,
    imageManager,
    spriteManager,
    isActive,
    hoverCellPosition,
    getCellContent,
  } = props;

  const cell = getCellContent([columnIndex, rowIndex]);
  const cellRenderer = getCellRenderer(cell.type);
  cellRenderer.draw(cell as never, {
    ctx,
    theme,
    rect: {
      x,
      y,
      width: width,
      height,
    },
    rowIndex,
    columnIndex,
    imageManager,
    spriteManager,
    hoverCellPosition,
    isActive,
  });
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const calcCells = (props: ILayoutDrawerProps, renderRegion: RenderRegion) => {
  const {
    coordInstance,
    visibleRegion,
    activeCell,
    mouseState,
    scrollState,
    selection,
    isSelecting,
    rowControls,
    rowIndexVisible,
    hoverCellPosition,
    theme,
    columns,
    commentCountMap,
    imageManager,
    spriteManager,
    groupCollection,
    getLinearRow,
    getCellContent,
  } = props;
  const {
    startRowIndex,
    stopRowIndex,
    startColumnIndex: originStartColumnIndex,
    stopColumnIndex: originStopColumnIndex,
  } = visibleRegion;
  const { freezeColumnCount, columnInitSize, totalWidth, rowCount } = coordInstance;
  const { isRowSelection, isColumnSelection } = selection;
  const { scrollLeft, scrollTop } = scrollState;
  const {
    columnIndex: hoverColumnIndex,
    rowIndex: hoverRowIndex,
    type: hoverRegionType,
    isOutOfBounds,
  } = mouseState;

  const cellPropList: ICellDrawerProps[] = [];
  const rowHeaderPropList: IRowHeaderDrawerProps[] = [];
  const groupRowList: IGroupRowDrawerProps[] = [];
  const groupRowHeaderList: IGroupRowHeaderDrawerProps[] = [];
  const appendRowList: IAppendRowDrawerProps[] = [];

  if (!rowCount) {
    return {
      cellPropList,
      rowHeaderPropList,
      groupRowList,
      groupRowHeaderList,
      appendRowList,
    };
  }

  const isFreezeRegion = renderRegion === RenderRegion.Freeze;
  const startColumnIndex = isFreezeRegion ? 0 : Math.max(freezeColumnCount, originStartColumnIndex);
  const stopColumnIndex = isFreezeRegion
    ? Math.max(freezeColumnCount - 1, 0)
    : originStopColumnIndex;
  const isFreezeWithoutColumns = isFreezeRegion && freezeColumnCount === 0;

  for (let columnIndex = startColumnIndex; columnIndex <= stopColumnIndex; columnIndex++) {
    const column = columns[columnIndex];
    const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const columnWidth = coordInstance.getColumnWidth(columnIndex);
    const isColumnActive = isColumnSelection && selection.includes([columnIndex, columnIndex]);
    const isFirstColumn = columnIndex === 0;
    const isColumnHovered = hoverColumnIndex === columnIndex;
    const finalTheme = column?.customTheme ? { ...theme, ...column.customTheme } : theme;
    const { cellBg, cellBgHovered, cellBgSelected } = finalTheme;

    for (let rowIndex = startRowIndex; rowIndex <= stopRowIndex; rowIndex++) {
      const linearRow = getLinearRow(rowIndex);
      const { type: linearRowType } = linearRow;
      const rowHeight = coordInstance.getRowHeight(rowIndex);
      const y = coordInstance.getRowOffset(rowIndex) - scrollTop;

      const cell = getCellContent([columnIndex, linearRow.realIndex]);
      const recordId = cell.id?.split('-')[0];

      if (linearRowType === LinearRowType.Group) {
        const { depth, value, isCollapsed } = linearRow;
        if (isFirstColumn) {
          groupRowHeaderList.push({
            x: 0.5,
            y,
            width: columnInitSize,
            height: rowHeight,
            spriteManager,
            depth,
            theme,
            isCollapsed,
            groupCollection,
          });
        }

        if (isFreezeWithoutColumns) continue;

        groupRowList.push({
          x: x + 0.5,
          y,
          width: columnWidth,
          height: rowHeight,
          columnIndex,
          rowIndex,
          depth,
          theme,
          value,
          isHover: false,
          isCollapsed,
          imageManager,
          spriteManager,
          groupCollection,
        });
        continue;
      }

      if (linearRowType === LinearRowType.Append) {
        if (isFirstColumn) {
          const isHover = hoverRegionType === RegionType.AppendRow && hoverRowIndex === rowIndex;

          appendRowList.push({
            x: 0.5,
            y: y + 0.5,
            width: totalWidth - scrollLeft,
            height: rowHeight,
            theme,
            isHover,
            spriteManager,
            coordInstance,
          });
        }
        continue;
      }

      const { displayIndex, realIndex: realRowIndex } = linearRow;
      const isRowHovered =
        !isOutOfBounds &&
        !isSelecting &&
        ROW_RELATED_REGIONS.has(hoverRegionType) &&
        rowIndex === hoverRowIndex;
      const { isCellActive, isRowActive } = checkIfRowOrCellActive(
        activeCell,
        realRowIndex,
        columnIndex
      );
      const { isRowSelected, isCellSelected } = checkIfRowOrCellSelected(
        selection,
        realRowIndex,
        columnIndex
      );
      let fill;

      if (isCellSelected || isRowSelected || isColumnActive) {
        fill = cellBgSelected;
      } else if (isRowHovered || isRowActive) {
        fill = cellBgHovered;
      }

      if (isFirstColumn) {
        rowHeaderPropList.push({
          x: 0.5,
          y: y + 0.5,
          width: columnInitSize + 0.5,
          height: rowHeight,
          displayIndex: String(displayIndex),
          isHover: isRowHovered || isRowActive,
          isChecked: isRowSelection && isRowSelected,
          rowIndexVisible,
          rowControls,
          theme,
          spriteManager,
          commentCount: recordId ? commentCountMap?.[recordId] : undefined,
        });
      }

      if (isFreezeWithoutColumns) continue;

      cellPropList.push({
        x: x + 0.5,
        y: y + 0.5,
        width: columnWidth,
        height: rowHeight,
        rowIndex: realRowIndex,
        columnIndex,
        hoverCellPosition: isColumnHovered && isRowHovered ? hoverCellPosition : null,
        getCellContent,
        imageManager,
        spriteManager,
        theme: finalTheme,
        fill: isCellActive ? cellBg : fill ?? cellBg,
      });
    }
  }

  return {
    cellPropList,
    rowHeaderPropList,
    groupRowList,
    groupRowHeaderList,
    appendRowList,
  };
};

export const drawClipRegion = (
  ctx: CanvasRenderingContext2D,
  clipRect: IRectangle,
  draw: (ctx: CanvasRenderingContext2D) => void
) => {
  const { x, y, width, height } = clipRect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  draw(ctx);

  ctx.restore();
};

export const drawCells = (
  mainCtx: CanvasRenderingContext2D,
  cacheCtx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const { coordInstance, theme, shouldRerender } = props;
  const { fontFamily, fontSizeSM, fontSizeXS, cellLineColor } = theme;
  const { rowInitSize, freezeRegionWidth, containerWidth, containerHeight } = coordInstance;

  const { cellPropList: otherCellPropList, groupRowList } = calcCells(props, RenderRegion.Other);
  const {
    cellPropList: freezeCellPropList,
    groupRowList: freezeGroupRowList,
    rowHeaderPropList,
    groupRowHeaderList,
    appendRowList,
  } = calcCells(props, RenderRegion.Freeze);

  appendRowList.forEach((props) => drawAppendRow(mainCtx, props));

  // Render freeze region
  drawClipRegion(
    mainCtx,
    {
      x: 0,
      y: rowInitSize + 1,
      width: freezeRegionWidth + 1,
      height: containerHeight - rowInitSize - 1,
    },
    (ctx: CanvasRenderingContext2D) => {
      freezeCellPropList.forEach((cellProps) => {
        const { x, y, width, height, fill } = cellProps;
        drawRect(ctx, {
          x,
          y,
          width,
          height,
          fill,
          stroke: cellLineColor,
        });
      });
      ctx.font = `${fontSizeXS}px ${fontFamily}`;
      rowHeaderPropList.forEach((rowHeaderProps) => drawRowHeader(ctx, rowHeaderProps));
      freezeGroupRowList.forEach((props) => drawGroupRow(ctx, props));
      groupRowHeaderList.forEach((props) => drawGroupRowHeader(ctx, props));
    }
  );

  // Render other region
  drawClipRegion(
    mainCtx,
    {
      x: freezeRegionWidth + 1,
      y: rowInitSize + 1,
      width: containerWidth - freezeRegionWidth,
      height: containerHeight - rowInitSize - 1,
    },
    (ctx: CanvasRenderingContext2D) => {
      otherCellPropList.forEach((cellProps) => {
        const { x, y, width, height, fill } = cellProps;
        drawRect(ctx, {
          x,
          y,
          width,
          height,
          fill,
          stroke: cellLineColor,
        });
      });
      groupRowList.forEach((props) => drawGroupRow(ctx, props));
    }
  );

  // Cache for cells content
  if (shouldRerender) {
    drawClipRegion(
      cacheCtx,
      {
        x: 0,
        y: rowInitSize + 1,
        width: freezeRegionWidth + 1,
        height: containerHeight - rowInitSize - 1,
      },
      (ctx: CanvasRenderingContext2D) => {
        ctx.font = `${fontSizeSM}px ${fontFamily}`;
        freezeCellPropList.forEach((cellProps) => {
          drawCellContent(ctx, cellProps);
        });
      }
    );

    drawClipRegion(
      cacheCtx,
      {
        x: freezeRegionWidth + 1,
        y: rowInitSize + 1,
        width: containerWidth - freezeRegionWidth,
        height: containerHeight - rowInitSize - 1,
      },
      (ctx: CanvasRenderingContext2D) => {
        ctx.font = `${fontSizeSM}px ${fontFamily}`;
        otherCellPropList.forEach((cellProps) => {
          drawCellContent(ctx, cellProps);
        });
      }
    );
  }
};

export const drawGroupRowHeader = (
  ctx: CanvasRenderingContext2D,
  props: IGroupRowHeaderDrawerProps
) => {
  const { x, y, width, height, theme, depth, isCollapsed, spriteManager, groupCollection } = props;
  const {
    iconSizeSM,
    cellLineColor,
    groupHeaderBgPrimary,
    groupHeaderBgSecondary,
    groupHeaderBgTertiary,
  } = theme;

  if (groupCollection == null) return;

  const { groupColumns } = groupCollection;

  if (!groupColumns.length) return;

  const bgList = [groupHeaderBgTertiary, groupHeaderBgSecondary, groupHeaderBgPrimary].slice(
    -groupColumns.length
  );

  drawRect(ctx, {
    x,
    y,
    width,
    height,
    fill: bgList[depth],
  });
  drawRect(ctx, {
    x,
    y,
    width,
    height: 1,
    fill: cellLineColor,
  });

  spriteManager.drawSprite(ctx, {
    sprite: isCollapsed ? GridInnerIcon.Collapse : GridInnerIcon.Expand,
    x: (width - iconSizeSM) / 2 + (depth - 1) * 16,
    y: y + (height - iconSizeSM) / 2,
    size: iconSizeSM,
    theme,
  });
};

export const drawGroupRow = (ctx: CanvasRenderingContext2D, props: IGroupRowDrawerProps) => {
  const {
    x,
    y,
    width,
    height,
    theme,
    columnIndex,
    rowIndex,
    depth,
    value,
    imageManager,
    spriteManager,
    groupCollection,
  } = props;
  const {
    fontSizeSM,
    fontFamily,
    cellLineColor,
    rowHeaderTextColor,
    groupHeaderBgPrimary,
    groupHeaderBgTertiary,
    groupHeaderBgSecondary,
  } = theme;

  if (groupCollection == null) return;

  const { groupColumns, getGroupCell } = groupCollection;

  if (!groupColumns.length) return;

  const bgList = [groupHeaderBgTertiary, groupHeaderBgSecondary, groupHeaderBgPrimary].slice(
    -groupColumns.length
  );

  drawRect(ctx, {
    x,
    y,
    width,
    height,
    fill: bgList[depth],
  });
  drawRect(ctx, {
    x,
    y,
    width,
    height: 1,
    fill: cellLineColor,
  });

  if (columnIndex !== 0) return;

  const groupColumn = groupColumns[depth];

  if (groupColumn == null) return;

  ctx.save();
  ctx.beginPath();
  ctx.font = `${fontSizeSM}px ${fontFamily}`;

  drawSingleLineText(ctx, {
    x: x + cellHorizontalPadding,
    y: y + cellVerticalPaddingSM,
    text: groupColumn.name,
    fill: rowHeaderTextColor,
  });

  const cell = getGroupCell(value, depth);
  const cellRenderer = getCellRenderer(cell.type);
  const offsetY = 18;
  cellRenderer.draw(cell as never, {
    ctx,
    theme,
    rect: {
      x,
      y: y + offsetY,
      width,
      height: height - offsetY,
    },
    rowIndex,
    columnIndex,
    imageManager,
    spriteManager,
  });
  ctx.restore();
};

export const drawActiveCell = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const {
    theme,
    mouseState,
    scrollState,
    coordInstance,
    activeCellBound,
    hoverCellPosition,
    imageManager,
    spriteManager,
    real2RowIndex,
    getLinearRow,
    getCellContent,
  } = props;

  if (activeCellBound == null) return;

  const { scrollTop, scrollLeft } = scrollState;
  const { width, height, columnIndex, rowIndex: activeRowIndex } = activeCellBound;
  const { rowIndex: hoverLinearRowIndex, columnIndex: hoverColumnIndex } = mouseState;
  const { cellBg, cellLineColorActived, fontSizeSM, fontFamily, scrollBarBg } = theme;
  const {
    freezeColumnCount,
    freezeRegionWidth,
    containerWidth,
    containerHeight,
    columnCount,
    rowInitSize,
  } = coordInstance;
  const activeLinearRowIndex = real2RowIndex(activeRowIndex);
  const linearRow = getLinearRow(activeLinearRowIndex);

  if (columnIndex >= columnCount || linearRow?.type !== LinearRowType.Row) return;

  const isFreezeRegion = columnIndex < freezeColumnCount;
  const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
  const y = coordInstance.getRowOffset(activeLinearRowIndex) - scrollTop;
  const { realIndex: hoverRowIndex } = getLinearRow(hoverLinearRowIndex);

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    isFreezeRegion ? 0 : freezeRegionWidth,
    rowInitSize,
    isFreezeRegion ? freezeRegionWidth + 1 : containerWidth - freezeRegionWidth,
    containerHeight - rowInitSize
  );
  ctx.clip();

  ctx.font = `${fontSizeSM}px ${fontFamily}`;

  drawRect(ctx, {
    x: x + 0.5,
    y: y + 0.5,
    width,
    height,
    fill: cellBg,
    stroke: cellLineColorActived,
    radius: 2,
  });

  const cellScrollState = getCellScrollState(activeCellBound);
  const { scrollBarHeight, scrollBarScrollTop, contentScrollTop } = cellScrollState;

  ctx.save();
  ctx.beginPath();

  if (activeCellBound.scrollEnable) {
    ctx.translate(0, scrollBarScrollTop);

    drawRect(ctx, {
      x: x + width - cellScrollBarWidth - cellScrollBarPaddingX,
      y: y + cellScrollBarPaddingY,
      width: cellScrollBarWidth,
      height: scrollBarHeight,
      fill: scrollBarBg,
      radius: cellScrollBarWidth / 2,
    });

    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y + 1, width, height - 1);
    ctx.clip();
    ctx.translate(0, -contentScrollTop);
  }

  drawCellContent(ctx, {
    x: x + 0.5,
    y: y + 0.5,
    width,
    height,
    rowIndex: activeRowIndex,
    columnIndex,
    hoverCellPosition:
      hoverRowIndex === activeRowIndex && hoverColumnIndex === columnIndex
        ? hoverCellPosition
        : null,
    getCellContent,
    isActive: true,
    imageManager,
    spriteManager,
    theme,
  });

  ctx.restore();
  ctx.restore();
};

const getVisibleCollaborators = (
  collaborators: ICollaborator,
  visibleRegion: IVisibleRegion,
  freezeColumnCount: number,
  getCellContent: (cell: ICellItem) => ICell,
  getLinearRow: (rowNumber: number) => ILinearRow
) => {
  const groupedCollaborators = groupBy(collaborators, 'activeCellId');

  // through visible region to find the cell that has collaborators and get the real coordinate
  const { startColumnIndex, stopColumnIndex, startRowIndex, stopRowIndex } = visibleRegion;

  const visibleCells = [];
  const columnIndices = [
    ...Array.from({ length: freezeColumnCount }, (_, i) => i),
    ...Array.from(
      { length: stopColumnIndex - Math.max(freezeColumnCount, startColumnIndex) + 1 },
      (_, i) => Math.max(freezeColumnCount, startColumnIndex) + i
    ),
  ];

  for (const i of columnIndices) {
    for (let j = startRowIndex; j < stopRowIndex; j++) {
      const realIndex = getLinearRow(j).realIndex;
      const cell = getCellContent([i, realIndex]);
      if (!cell?.id) {
        continue;
      }
      const visibleCell = groupedCollaborators[cell.id];
      if (visibleCell) {
        const newCell = cloneDeep(visibleCell);
        newCell[0].activeCell = [i, realIndex];
        visibleCells.push(newCell);
      }
    }
  }

  return visibleCells;
};

// TODO optimize the performance
export const drawCollaborators = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const {
    collaborators,
    scrollState,
    coordInstance,
    activeCellBound,
    theme,
    real2RowIndex,
    getCellContent,
    visibleRegion,
    getLinearRow,
  } = props;
  const { scrollTop, scrollLeft } = scrollState;
  const { themeKey } = theme;

  const { freezeColumnCount, freezeRegionWidth, rowInitSize, containerWidth, containerHeight } =
    coordInstance;

  if (!collaborators?.length) return;

  ctx.save();

  const visibleCells = getVisibleCollaborators(
    collaborators,
    visibleRegion,
    freezeColumnCount,
    getCellContent,
    getLinearRow
  );

  for (let i = 0; i < visibleCells.length; i++) {
    // for conflict cell, we'd like to show the latest collaborator
    const conflictCollaborators = visibleCells[i].sort((a, b) => b.timeStamp - a.timeStamp);
    const { activeCell, borderColor } = conflictCollaborators[0];
    if (!activeCell) {
      continue;
    }
    const [columnIndex, _rowIndex] = activeCell;
    const rowIndex = real2RowIndex(_rowIndex);
    const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const y = coordInstance.getRowOffset(rowIndex) - scrollTop;
    const width = coordInstance.getColumnWidth(columnIndex);
    const height =
      activeCellBound?.columnIndex === columnIndex && activeCellBound?.rowIndex === rowIndex
        ? activeCellBound.height
        : coordInstance.getRowHeight(rowIndex);

    ctx.save();
    ctx.beginPath();

    const isFreezeRegion = columnIndex < freezeColumnCount;

    // clip otherwise collaborator will be rendered outside the cell
    ctx.rect(
      isFreezeRegion ? 0 : freezeRegionWidth,
      rowInitSize,
      isFreezeRegion ? freezeRegionWidth + 1 : containerWidth - freezeRegionWidth,
      containerHeight - rowInitSize
    );
    ctx.clip();

    drawRect(ctx, {
      x: x + 0.5,
      y: y + 0.5,
      width,
      height: height,
      stroke: hexToRGBA(contractColorForTheme(borderColor, themeKey)),
      radius: 2,
    });

    ctx.restore();
  }
  ctx.restore();
};

export const drawSearchCursor = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const {
    theme,
    scrollState,
    coordInstance,
    real2RowIndex,
    getLinearRow,
    searchCursor,
    imageManager,
    spriteManager,
    getCellContent,
  } = props;

  if (!searchCursor) return;

  const [searchColumnIndex, searchRowIndex] = searchCursor;

  const { scrollTop, scrollLeft } = scrollState;
  const { fontSizeSM, fontFamily } = theme;
  const {
    freezeColumnCount,
    freezeRegionWidth,
    containerWidth,
    containerHeight,
    columnCount,
    rowInitSize,
  } = coordInstance;
  const activeLinearRowIndex = real2RowIndex(searchRowIndex);
  const linearRow = getLinearRow(activeLinearRowIndex);

  if (searchColumnIndex >= columnCount || linearRow?.type !== LinearRowType.Row) return;

  const isFreezeRegion = searchColumnIndex < freezeColumnCount;
  const x = coordInstance.getColumnRelativeOffset(searchColumnIndex, scrollLeft);
  const y = coordInstance.getRowOffset(activeLinearRowIndex) - scrollTop;

  const width = coordInstance.getColumnWidth(searchColumnIndex);
  const height = coordInstance.getRowHeight(activeLinearRowIndex);

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    isFreezeRegion ? 0 : freezeRegionWidth,
    rowInitSize,
    isFreezeRegion ? freezeRegionWidth + 1 : containerWidth - freezeRegionWidth,
    containerHeight - rowInitSize
  );
  ctx.clip();

  ctx.font = `${fontSizeSM}px ${fontFamily}`;

  drawRect(ctx, {
    x: x + 1,
    y: y + 1,
    width: width - 1,
    height: height - 1,
    fill: theme.searchCursorBg,
    radius: 0.5,
  });

  ctx.save();
  ctx.beginPath();

  drawCellContent(ctx, {
    x: x + 0.5,
    y: y + 0.5,
    width,
    height,
    rowIndex: searchRowIndex,
    columnIndex: searchColumnIndex,
    getCellContent,
    isActive: false,
    imageManager,
    spriteManager,
    theme,
  });

  ctx.restore();
  ctx.restore();
};

export const drawSearchResult = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps,
  result?: [number, number]
) => {
  const {
    theme,
    scrollState,
    coordInstance,
    real2RowIndex,
    getLinearRow,
    imageManager,
    spriteManager,
    getCellContent,
  } = props;

  if (!result) return;

  const [searchColumnIndex, searchRowIndex] = result;

  const { scrollTop, scrollLeft } = scrollState;
  const { fontSizeSM, fontFamily, searchTargetIndexBg } = theme;
  const {
    freezeColumnCount,
    freezeRegionWidth,
    containerWidth,
    containerHeight,
    columnCount,
    rowInitSize,
  } = coordInstance;
  const activeLinearRowIndex = real2RowIndex(searchRowIndex);
  const linearRow = getLinearRow(activeLinearRowIndex);

  if (searchColumnIndex >= columnCount || linearRow?.type !== LinearRowType.Row) return;

  const isFreezeRegion = searchColumnIndex < freezeColumnCount;
  const x = coordInstance.getColumnRelativeOffset(searchColumnIndex, scrollLeft);
  const y = coordInstance.getRowOffset(activeLinearRowIndex) - scrollTop;

  const width = coordInstance.getColumnWidth(searchColumnIndex);
  const height = coordInstance.getRowHeight(activeLinearRowIndex);

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    isFreezeRegion ? 0 : freezeRegionWidth,
    rowInitSize,
    isFreezeRegion ? freezeRegionWidth + 1 : containerWidth - freezeRegionWidth,
    containerHeight - rowInitSize
  );
  ctx.clip();

  ctx.font = `${fontSizeSM}px ${fontFamily}`;

  drawRect(ctx, {
    x: x + 1,
    y: y + 1,
    width: width - 1,
    height: height - 1,
    fill: searchTargetIndexBg,
    radius: 0.5,
  });

  ctx.save();
  ctx.beginPath();

  drawCellContent(ctx, {
    x: x + 0.5,
    y: y + 0.5,
    width,
    height,
    rowIndex: linearRow.realIndex,
    columnIndex: searchColumnIndex,
    getCellContent,
    isActive: false,
    imageManager,
    spriteManager,
    theme,
  });

  ctx.restore();
  ctx.restore();
};

export const getVisibleSearchTargetIndex = (
  searchHitIndex: { fieldId: string; recordId: string }[],
  visibleRegion: IVisibleRegion,
  freezeColumnCount: number,
  getCellContent: (cell: ICellItem) => ICell,
  getLinearRow: (rowNumber: number) => ILinearRow
) => {
  const { startColumnIndex, stopColumnIndex, startRowIndex, stopRowIndex } = visibleRegion;

  const searchCells = [];
  const columnIndices = [
    ...Array.from({ length: freezeColumnCount }, (_, i) => i),
    ...Array.from(
      { length: stopColumnIndex - Math.max(freezeColumnCount, startColumnIndex) + 1 },
      (_, i) => Math.max(freezeColumnCount, startColumnIndex) + i
    ),
  ];

  const searchCellIds = searchHitIndex?.map((item) => `${item.recordId}-${item.fieldId}`) || [];

  for (const i of columnIndices) {
    for (let j = startRowIndex; j < stopRowIndex; j++) {
      const line = getLinearRow(j);
      const { realIndex } = line;
      const cell = getCellContent([i, realIndex]);

      if (!cell?.id) {
        continue;
      }

      if (searchCellIds.includes(cell.id)) {
        searchCells.push([i, realIndex]);
      }
    }
  }

  return searchCells as [number, number][];
};

export const drawSearchTargetIndex = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const { getCellContent, coordInstance, visibleRegion, searchHitIndex, getLinearRow } = props;

  const { freezeColumnCount } = coordInstance;

  if (!searchHitIndex?.length) return;

  const searchCellIds = getVisibleSearchTargetIndex(
    searchHitIndex,
    visibleRegion,
    freezeColumnCount,
    getCellContent,
    getLinearRow
  );

  for (let i = 0; i < searchCellIds.length; i++) {
    drawSearchResult(ctx, props, searchCellIds[i]);
  }
};

export const drawFillHandler = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const { coordInstance, scrollState, selection, isSelecting, isEditing, theme } = props;
  const { scrollTop, scrollLeft } = scrollState;
  const { freezeColumnCount, freezeRegionWidth, rowInitSize, containerWidth, containerHeight } =
    coordInstance;
  if (isEditing || isSelecting) return;
  const maxRange = calculateMaxRange(selection);
  if (maxRange == null) return;

  const [columnIndex, rowIndex] = maxRange;
  const { cellBg, cellLineColorActived } = theme;
  const isFreezeRegion = columnIndex < freezeColumnCount;
  const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
  const y = coordInstance.getRowOffset(rowIndex) - scrollTop;
  const width = coordInstance.getColumnWidth(columnIndex);
  const height = coordInstance.getRowHeight(rowIndex);

  ctx.save();
  ctx.beginPath();
  if (!isFreezeRegion) {
    ctx.rect(
      freezeRegionWidth,
      rowInitSize,
      containerWidth - freezeRegionWidth,
      containerHeight - rowInitSize
    );
    ctx.clip();
  }

  drawRect(ctx, {
    x: x + width - fillHandlerSize / 2 - 0.5,
    y: y + height - fillHandlerSize / 2 - 0.5,
    width: fillHandlerSize,
    height: fillHandlerSize,
    stroke: cellLineColorActived,
    fill: cellBg,
  });

  ctx.restore();
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const drawRowHeader = (ctx: CanvasRenderingContext2D, props: IRowHeaderDrawerProps) => {
  const {
    x,
    y,
    width,
    height,
    displayIndex,
    theme,
    isHover,
    isChecked,
    rowControls,
    spriteManager,
    rowIndexVisible,
    commentCount,
  } = props;

  const {
    cellBg,
    cellBgHovered,
    cellBgSelected,
    cellLineColor,
    rowHeaderTextColor,
    iconSizeXS,
    staticWhite,
    iconBgSelected,
  } = theme;
  let fill = cellBg;

  if (isChecked) {
    fill = cellBgSelected;
  } else if (isHover) {
    fill = cellBgHovered;
  }

  drawRect(ctx, {
    x,
    y,
    width,
    height,
    fill,
  });
  drawLine(ctx, {
    x,
    y,
    points: [0, 0, width, 0],
    stroke: cellLineColor,
  });
  drawLine(ctx, {
    x,
    y,
    points: [0, height, width, height],
    stroke: cellLineColor,
  });
  const halfSize = iconSizeXS / 2;

  ctx.font = `${10}px ${theme.fontFamily}`;

  if (commentCount) {
    const controlSize = width / rowControls.length;
    const offsetX = controlSize * (2 + 0.5);
    drawCommentCount(ctx, {
      x: x + offsetX - halfSize,
      y: y + rowHeadIconPaddingTop,
      count: commentCount,
      theme,
    });
  }

  if (isChecked || isHover || !rowIndexVisible) {
    const controlSize = width / rowControls.length;
    for (let i = 0; i < rowControls.length; i++) {
      const { type, icon } = rowControls[i];
      const offsetX = controlSize * (i + 0.5);

      if (type === RowControlType.Checkbox) {
        drawCheckbox(ctx, {
          x: x + offsetX - halfSize,
          y: y + rowHeadIconPaddingTop,
          size: iconSizeXS,
          stroke: isChecked ? staticWhite : rowHeaderTextColor,
          fill: isChecked ? iconBgSelected : undefined,
          isChecked,
        });
      } else {
        if (isChecked && !isHover && rowIndexVisible && type === RowControlType.Expand) continue;
        if (!commentCount || type !== RowControlType.Expand) {
          spriteManager.drawSprite(ctx, {
            sprite: icon || spriteIconMap[type],
            x: x + offsetX - halfSize,
            y: y + rowHeadIconPaddingTop,
            size: iconSizeXS,
            theme,
          });
        }
      }
    }
    return;
  }

  drawSingleLineText(ctx, {
    x: x + width / 2,
    y: y + cellVerticalPaddingMD + 1,
    text: displayIndex,
    textAlign: 'center',
    fill: rowHeaderTextColor,
  });
};

export const drawCommentCount = (
  ctx: CanvasRenderingContext2D,
  props: {
    x: number;
    y: number;
    count: number;
    theme: IGridTheme;
  }
) => {
  const { theme } = props;
  const { commentCountBg, commentCountTextColor } = theme;
  drawRect(ctx, {
    ...props,
    x: props.x,
    y: props.y,
    width: 18,
    height: 16,
    stroke: commentCountBg,
    radius: 3,
    fill: commentCountBg,
  });

  drawSingleLineText(ctx, {
    ...props,
    x: props.x + 9,
    y: props.y + 3.5,
    text: props.count > 99 ? '99+' : props.count.toString(),
    textAlign: 'center',
    verticalAlign: 'middle',
    fontSize: 10,
    fill: commentCountTextColor,
  });
};

export const drawColumnHeader = (ctx: CanvasRenderingContext2D, props: IFieldHeadDrawerProps) => {
  const { x, y, width, height, theme, fill, column, hasMenu, spriteManager } = props;
  const { name, icon, description, hasMenu: hasColumnMenu, isPrimary } = column;
  const {
    cellLineColor,
    columnHeaderBg,
    iconFgCommon,
    columnHeaderNameColor,
    fontSizeSM,
    iconSizeXS,
  } = theme;
  let maxTextWidth = width - columnHeadPadding * 2;
  let iconOffsetX = columnHeadPadding;
  const hasMenuInner = hasMenu && hasColumnMenu;

  drawRect(ctx, {
    x: x + 0.5,
    y,
    width: width - 0.5,
    height,
    fill: fill ?? columnHeaderBg,
  });
  drawLine(ctx, {
    x,
    y,
    points: [0, height, width, height, width, 0],
    stroke: cellLineColor,
  });

  if (isPrimary) {
    maxTextWidth = maxTextWidth - iconSizeXS - columnHeadPadding;
    spriteManager.drawSprite(ctx, {
      sprite: GridInnerIcon.Lock,
      x: x + iconOffsetX,
      y: y + (height - iconSizeXS) / 2,
      size: iconSizeXS,
      theme,
    });
    iconOffsetX += iconSizeXS + columnHeadPadding / 2;
  }

  if (icon) {
    maxTextWidth = maxTextWidth - iconSizeXS;
    spriteManager.drawSprite(ctx, {
      sprite: icon,
      x: x + iconOffsetX,
      y: y + (height - iconSizeXS) / 2,
      size: iconSizeXS,
      theme,
    });
    iconOffsetX += iconSizeXS + columnHeadPadding / 2;
  }

  if (hasMenuInner) {
    maxTextWidth = maxTextWidth - columnHeadMenuSize - columnHeadPadding;
    drawRoundPoly(ctx, {
      points: [
        {
          x: x + width - columnHeadPadding - columnHeadMenuSize,
          y: y + height / 2 - columnHeadMenuSize / 4,
        },
        {
          x: x + width - columnHeadPadding,
          y: y + height / 2 - columnHeadMenuSize / 4,
        },
        {
          x: x + width - columnHeadPadding - columnHeadMenuSize / 2,
          y: y + height / 2 + columnHeadMenuSize / 4,
        },
      ],
      radiusAll: 1,
      fill: iconFgCommon,
    });
  }

  if (description) {
    spriteManager.drawSprite(ctx, {
      sprite: GridInnerIcon.Description,
      x: hasMenuInner
        ? x + width - 2 * iconSizeXS - columnHeadPadding
        : x + width - iconSizeXS - columnHeadPadding,
      y: y + (height - iconSizeXS) / 2,
      size: iconSizeXS,
      theme,
    });

    maxTextWidth = maxTextWidth - iconSizeXS - columnHeadPadding;
  }

  drawSingleLineText(ctx, {
    x: x + iconOffsetX,
    y: y + cellVerticalPaddingMD,
    text: name,
    fill: columnHeaderNameColor,
    fontSize: fontSizeSM,
    maxWidth: maxTextWidth,
  });
};

export const drawGridHeader = (ctx: CanvasRenderingContext2D, props: IGridHeaderDrawerProps) => {
  const { x, y, width, height, theme, rowControls, isChecked, isMultiSelectionEnable } = props;
  const {
    iconSizeXS,
    staticWhite,
    columnHeaderBg,
    cellLineColor,
    rowHeaderTextColor,
    iconBgSelected,
  } = theme;
  const halfSize = iconSizeXS / 2;
  drawRect(ctx, {
    x,
    y,
    width,
    height,
    fill: columnHeaderBg,
  });
  drawLine(ctx, {
    x,
    y,
    points: [0, height, width, height],
    stroke: cellLineColor,
  });

  if (isMultiSelectionEnable && rowControls.some((item) => item.type === RowControlType.Checkbox)) {
    drawCheckbox(ctx, {
      x: width / 2 - halfSize + 0.5,
      y: height / 2 - halfSize + 0.5,
      size: iconSizeXS,
      stroke: isChecked ? staticWhite : rowHeaderTextColor,
      fill: isChecked ? iconBgSelected : undefined,
      isChecked,
    });
  }
};

export const drawColumnHeaders = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps,
  renderRegion: RenderRegion
  // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  const {
    visibleRegion,
    coordInstance,
    columns,
    theme,
    spriteManager,
    mouseState,
    scrollState,
    selection,
    rowControls,
    isInteracting,
    isColumnHeaderMenuVisible,
    isMultiSelectionEnable,
  } = props;
  const { startColumnIndex: originStartColumnIndex, stopColumnIndex: originStopColumnIndex } =
    visibleRegion;
  const {
    containerWidth,
    freezeRegionWidth,
    rowInitSize,
    columnInitSize,
    freezeColumnCount,
    pureRowCount,
  } = coordInstance;
  const { scrollLeft } = scrollState;
  const { fontSizeSM, fontFamily } = theme;
  const { isColumnSelection, isRowSelection, ranges: selectionRanges } = selection;
  const { type: hoverRegionType, columnIndex: hoverColumnIndex } = mouseState;
  const isFreezeRegion = renderRegion === RenderRegion.Freeze;
  const startColumnIndex = isFreezeRegion ? 0 : Math.max(freezeColumnCount, originStartColumnIndex);
  const stopColumnIndex = isFreezeRegion
    ? Math.max(freezeColumnCount - 1, 0)
    : originStopColumnIndex;
  const endRowIndex = pureRowCount - 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    isFreezeRegion ? 0 : freezeRegionWidth + 1,
    0,
    isFreezeRegion ? freezeRegionWidth + 1 : containerWidth - freezeRegionWidth,
    rowInitSize + 1
  );
  ctx.clip();
  ctx.font = `normal ${fontSizeSM}px ${fontFamily}`;

  for (let columnIndex = startColumnIndex; columnIndex <= stopColumnIndex; columnIndex++) {
    const column = columns[columnIndex];
    const finalTheme = column?.customTheme ? { ...theme, ...column.customTheme } : theme;
    const { columnHeaderBgHovered, columnHeaderBgSelected } = finalTheme;
    const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const columnWidth = coordInstance.getColumnWidth(columnIndex);
    const isActive = isColumnSelection && selection.includes([columnIndex, columnIndex]);
    const isHover =
      !isInteracting &&
      [RegionType.ColumnHeader, RegionType.ColumnHeaderMenu].includes(hoverRegionType) &&
      hoverColumnIndex === columnIndex;
    let fill = undefined;

    if (isActive) {
      fill = columnHeaderBgSelected;
    } else if (isHover) {
      fill = columnHeaderBgHovered;
    }

    column &&
      drawColumnHeader(ctx, {
        x: x + 0.5,
        y: 0.5,
        width: columnWidth,
        height: rowInitSize,
        column: column,
        fill,
        hasMenu: isColumnHeaderMenuVisible,
        theme: finalTheme,
        spriteManager,
      });
  }

  const isChecked = isRowSelection && isEqual(selectionRanges[0], [0, endRowIndex]);
  drawGridHeader(ctx, {
    x: 0,
    y: 0.5,
    width: columnInitSize + 1.5,
    height: rowInitSize,
    theme,
    rowControls,
    isChecked,
    isMultiSelectionEnable,
  });

  ctx.restore();
};

export const drawAppendRow = (ctx: CanvasRenderingContext2D, props: IAppendRowDrawerProps) => {
  const { x, y, width, height, theme, isHover, coordInstance, spriteManager } = props;
  const { appendRowBgHovered, iconSizeSM, cellBg, cellLineColor } = theme;
  const { columnInitSize } = coordInstance;
  const halfIconSize = iconSizeSM / 2;

  ctx.save();
  ctx.beginPath();
  drawRect(ctx, {
    x: x + 0.5,
    y: y + 0.5,
    width,
    height,
    fill: isHover ? appendRowBgHovered : cellBg,
  });
  drawRect(ctx, {
    x,
    y: y + height,
    width,
    height: 1,
    fill: cellLineColor,
  });
  spriteManager.drawSprite(ctx, {
    sprite: GridInnerIcon.Add,
    x: x + columnInitSize / 2 - halfIconSize + 0.5,
    y: y + height / 2 - halfIconSize + 0.5,
    size: iconSizeSM,
    theme,
  });
  ctx.restore();
};

export const drawAppendColumn = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const { coordInstance, theme, mouseState, scrollState, isColumnAppendEnable, spriteManager } =
    props;
  const { scrollLeft, scrollTop } = scrollState;
  const { totalWidth, totalHeight } = coordInstance;
  const { type: hoverRegionType } = mouseState;

  if (!isColumnAppendEnable) return;

  const { iconSizeSM, columnHeaderBg, cellLineColor, columnHeaderBgHovered } = theme;
  const isHover = hoverRegionType === RegionType.AppendColumn;
  const x = totalWidth - scrollLeft;

  drawRect(ctx, {
    x: x + 1,
    y: 0.5,
    width: columnAppendBtnWidth,
    height: totalHeight - scrollTop,
    fill: isHover ? columnHeaderBgHovered : columnHeaderBg,
  });
  drawLine(ctx, {
    x: x + 0.5,
    y: columnHeadHeight + 0.5,
    points: [0, 0, 0, totalHeight - scrollTop - columnHeadHeight],
    stroke: cellLineColor,
  });

  const halfIconSize = iconSizeSM / 2;
  spriteManager.drawSprite(ctx, {
    sprite: GridInnerIcon.Add,
    x: x + columnAppendBtnWidth / 2 - halfIconSize + 0.5,
    y: columnHeadHeight / 2 - halfIconSize + 0.5,
    size: iconSizeSM,
    theme,
  });
};

export const drawColumnResizeHandler = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const {
    theme,
    scrollState,
    coordInstance,
    isColumnResizable,
    columnResizeState,
    hoveredColumnResizeIndex,
  } = props;
  const { columnIndex: resizeColumnIndex } = columnResizeState;
  const isHover = isColumnResizable && hoveredColumnResizeIndex > -1;
  const isResizing = resizeColumnIndex > -1;

  if (!isHover && !isResizing) return;

  const { scrollLeft } = scrollState;
  const { rowInitSize } = coordInstance;
  const { columnResizeHandlerBg } = theme;
  let x = 0;

  if (isResizing) {
    const columnWidth = coordInstance.getColumnWidth(resizeColumnIndex);
    x = coordInstance.getColumnRelativeOffset(resizeColumnIndex, scrollLeft) + columnWidth;
  } else {
    const realColumnWidth = coordInstance.getColumnWidth(hoveredColumnResizeIndex);
    x =
      coordInstance.getColumnRelativeOffset(hoveredColumnResizeIndex, scrollLeft) + realColumnWidth;
  }

  drawRect(ctx, {
    x: x - columnResizeHandlerWidth / 2 + 0.5,
    y: columnResizeHandlerPaddingTop + 0.5,
    width: columnResizeHandlerWidth,
    height: rowInitSize - columnResizeHandlerPaddingTop * 2,
    fill: columnResizeHandlerBg,
    radius: 3,
  });
};

export const drawColumnDraggingRegion = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const { columns, theme, mouseState, scrollState, dragState, coordInstance } = props;
  const { columnDraggingPlaceholderBg, interactionLineColorHighlight } = theme;
  const { type, isDragging, ranges: draggingRanges, delta } = dragState;
  const { containerHeight } = coordInstance;
  const { x } = mouseState;
  const { scrollLeft } = scrollState;

  if (!isDragging || type !== DragRegionType.Columns) return;

  const draggingColIndex = draggingRanges[0][0];
  drawRect(ctx, {
    x: x - delta,
    y: 0.5,
    width: columns[draggingColIndex].width as number,
    height: containerHeight,
    fill: columnDraggingPlaceholderBg,
  });

  const targetColumnIndex = getDropTargetIndex(coordInstance, mouseState, scrollState, type);
  const finalX = coordInstance.getColumnRelativeOffset(targetColumnIndex, scrollLeft);

  drawRect(ctx, {
    x: finalX - 0.5,
    y: 0.5,
    width: 2,
    height: containerHeight,
    fill: interactionLineColorHighlight,
  });
};

export const drawRowDraggingRegion = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const { theme, mouseState, scrollState, dragState, coordInstance } = props;
  const { columnDraggingPlaceholderBg, interactionLineColorHighlight } = theme;
  const { type, isDragging, ranges: draggingRanges, delta } = dragState;
  const { containerWidth } = coordInstance;
  const { scrollTop } = scrollState;
  const { y } = mouseState;

  if (!isDragging || type !== DragRegionType.Rows) return;

  const draggingRowIndex = draggingRanges[0][0];
  drawRect(ctx, {
    x: 0.5,
    y: y - delta,
    width: containerWidth,
    height: coordInstance.getRowHeight(draggingRowIndex),
    fill: columnDraggingPlaceholderBg,
  });

  const targetRowIndex = getDropTargetIndex(coordInstance, mouseState, scrollState, type);
  const offsetY = coordInstance.getRowOffset(targetRowIndex);
  const finalY = offsetY - scrollTop;

  drawRect(ctx, {
    x: 0.5,
    y: finalY - 0.5,
    width: containerWidth,
    height: 2,
    fill: interactionLineColorHighlight,
  });
};

export const drawColumnFreezeHandler = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const { coordInstance, mouseState, scrollState, columnFreezeState, theme } = props;
  const { isFreezing, targetIndex } = columnFreezeState;
  const { type, x, y } = mouseState;

  if (type !== RegionType.ColumnFreezeHandler && !isFreezing) return;

  const { scrollLeft } = scrollState;
  const { interactionLineColorHighlight } = theme;
  const { containerHeight, freezeRegionWidth } = coordInstance;
  const hoverX = isFreezing ? x : freezeRegionWidth;

  if (isFreezing) {
    const targetX = coordInstance.getColumnRelativeOffset(targetIndex + 1, scrollLeft);
    drawRect(ctx, {
      x: targetX - 1,
      y: 0,
      width: 2,
      height: containerHeight,
      fill: interactionLineColorHighlight,
    });
  }

  drawRect(ctx, {
    x: hoverX - columnFreezeHandlerWidth / 2,
    y: y - columnFreezeHandlerHeight / 2,
    width: columnFreezeHandlerWidth,
    height: columnFreezeHandlerHeight,
    fill: interactionLineColorHighlight,
    radius: 4,
  });
  drawRect(ctx, {
    x: hoverX - 1,
    y: 0,
    width: 2,
    height: containerHeight,
    fill: interactionLineColorHighlight,
  });
};

const setVisibleImageRegion = (props: ILayoutDrawerProps) => {
  const { imageManager, coordInstance, visibleRegion, getLinearRow } = props;
  const { startColumnIndex, stopColumnIndex, startRowIndex, stopRowIndex } = visibleRegion;
  const realStartRowIndex = getLinearRow(startRowIndex).realIndex;
  const realStopRowIndex = getLinearRow(stopRowIndex).realIndex;
  const { freezeColumnCount } = coordInstance;
  imageManager?.setWindow(
    {
      x: startColumnIndex,
      y: realStartRowIndex,
      width: stopColumnIndex - startColumnIndex,
      height: realStopRowIndex - realStartRowIndex,
    },
    freezeColumnCount
  );
};

export const drawFreezeRegionDivider = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps,
  dividerRegion: DividerRegion
) => {
  const { theme, coordInstance, scrollState, height } = props;
  const { interactionLineColorCommon } = theme;
  const { scrollLeft } = scrollState;
  const { freezeRegionWidth, containerHeight } = coordInstance;
  const isTop = dividerRegion === DividerRegion.Top;

  const startY = isTop ? 0 : containerHeight;
  const endY = isTop ? containerHeight : height;

  if (scrollLeft === 0) {
    return drawRect(ctx, {
      x: freezeRegionWidth,
      y: startY + 0.5,
      width: 1,
      height: endY - startY,
      fill: interactionLineColorCommon,
    });
  }

  ctx.save();
  ctx.beginPath();

  ctx.shadowColor = interactionLineColorCommon;
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 3;
  ctx.strokeStyle = interactionLineColorCommon;

  ctx.moveTo(freezeRegionWidth + 0.5, startY);
  ctx.lineTo(freezeRegionWidth + 0.5, endY);
  ctx.stroke();

  ctx.restore();
};

export const drawColumnHeadersRegion = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const { columnHeaderVisible } = props;

  if (!columnHeaderVisible) return;

  [RenderRegion.Freeze, RenderRegion.Other].forEach((r) => drawColumnHeaders(ctx, props, r));
  drawAppendColumn(ctx, props);
};

export const drawColumnStatistics = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps,
  renderRegion: RenderRegion
  // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  const {
    coordInstance,
    columns,
    theme,
    height,
    visibleRegion,
    mouseState,
    scrollState,
    columnStatistics,
    groupCollection,
    getLinearRow,
  } = props;

  if (columnStatistics == null) return;

  const { scrollLeft, scrollTop } = scrollState;
  let { startColumnIndex, stopColumnIndex } = visibleRegion;
  const { startRowIndex, stopRowIndex } = visibleRegion;
  const { type, columnIndex: hoverColumnIndex, rowIndex: hoverRowIndex } = mouseState;
  const { rowInitSize, containerHeight, containerWidth, freezeRegionWidth, freezeColumnCount } =
    coordInstance;
  const {
    fontSizeXS,
    fontFamily,
    columnHeaderBg,
    groupHeaderBgTertiary,
    groupHeaderBgSecondary,
    groupHeaderBgPrimary,
  } = theme;
  const isFreezeRegion = renderRegion === RenderRegion.Freeze;
  const y = containerHeight + 0.5;

  startColumnIndex = isFreezeRegion ? 0 : Math.max(freezeColumnCount, startColumnIndex);
  stopColumnIndex = isFreezeRegion ? Math.max(freezeColumnCount - 1, 0) : stopColumnIndex;

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    isFreezeRegion ? 0 : freezeRegionWidth,
    rowInitSize,
    isFreezeRegion ? freezeRegionWidth : containerWidth - freezeRegionWidth,
    height
  );
  ctx.clip();
  ctx.font = `${fontSizeXS}px ${fontFamily}`;

  const { groupColumns } = groupCollection ?? {};

  for (let columnIndex = startColumnIndex; columnIndex <= stopColumnIndex; columnIndex++) {
    const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const columnWidth = coordInstance.getColumnWidth(columnIndex);
    const isFirstColumn = columnIndex === 0;
    const isColumnHovered = columnIndex === hoverColumnIndex;
    const column = columns[columnIndex];

    if (column == null) continue;

    const { id: columnId, name, statisticLabel } = column;

    if (groupColumns != null) {
      const bgList = [groupHeaderBgTertiary, groupHeaderBgSecondary, groupHeaderBgPrimary].slice(
        -groupColumns.length
      );

      for (let rowIndex = startRowIndex; rowIndex <= stopRowIndex; rowIndex++) {
        const linearRow = getLinearRow(rowIndex);
        const rowHeight = coordInstance.getRowHeight(rowIndex);
        const { type: linearRowType } = linearRow;
        const y = coordInstance.getRowOffset(rowIndex) - scrollTop;

        if (linearRowType === LinearRowType.Group) {
          const { id, depth } = linearRow;
          const text = columnStatistics[columnId ?? name]?.[id];

          const labelWidth = isFirstColumn
            ? Math.min(
                drawSingleLineText(ctx, {
                  maxWidth: columnWidth,
                  text: text ?? statisticLabel?.label ?? 'Summary',
                  needRender: false,
                  fontSize: fontSizeXS,
                }).width + cellHorizontalPadding,
                columnWidth
              )
            : columnWidth - 1;

          drawStatisticCell(ctx, {
            x: isFirstColumn ? x + columnWidth - labelWidth : x + 1,
            y: y + 1,
            textOffsetY: columnStatisticHeight / 2 - 2,
            width: labelWidth,
            height: rowHeight - 1,
            text,
            defaultLabel: statisticLabel?.label,
            bgColor: isFirstColumn && text ? bgList[depth] : undefined,
            isHovered:
              isColumnHovered && rowIndex === hoverRowIndex && type === RegionType.GroupStatistic,
            theme,
          });
        }
      }
    }

    const text = columnStatistics[columnId ?? name]?.total;

    drawStatisticCell(ctx, {
      x,
      y: y + 1,
      textOffsetY: cellVerticalPaddingMD,
      width: columnWidth,
      height: columnStatisticHeight,
      text,
      bgColor: columnHeaderBg,
      isHovered: isColumnHovered && type === RegionType.ColumnStatistic,
      showAlways: statisticLabel?.showAlways,
      defaultLabel: statisticLabel?.label,
      theme,
    });
  }

  ctx.restore();
};

export const drawStatisticCell = (
  ctx: CanvasRenderingContext2D,
  props: IGroupStatisticDrawerProps
) => {
  const {
    x,
    y,
    width,
    height,
    text,
    textOffsetY,
    isHovered,
    showAlways,
    theme,
    defaultLabel,
    bgColor,
  } = props;
  const { rowHeaderTextColor, columnStatisticBgHovered, fontSizeXS } = theme;

  if (text || isHovered || showAlways || bgColor) {
    drawRect(ctx, {
      x,
      y,
      width,
      height,
      fill: isHovered ? columnStatisticBgHovered : bgColor,
    });
  }

  const textProp: Omit<ISingleLineTextProps, 'text'> = {
    x: x + 0.5,
    y: y + (textOffsetY ?? 0.5),
    textAlign: 'right',
    maxWidth: width - cellHorizontalPadding / 2,
    fill: rowHeaderTextColor,
    fontSize: fontSizeXS,
  };

  if (isHovered || showAlways) {
    !text && drawSingleLineText(ctx, { ...textProp, text: defaultLabel || 'Summary' });
  }

  if (text) {
    drawSingleLineText(ctx, { ...textProp, text });
  }
};

export const drawColumnStatisticsRegion = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const { coordInstance, theme, columnStatistics, height } = props;
  const { containerWidth } = coordInstance;
  const { cellLineColor } = theme;
  const y = height - columnStatisticHeight + 0.5;

  if (columnStatistics == null) return;

  [RenderRegion.Freeze, RenderRegion.Other].forEach((r) => drawColumnStatistics(ctx, props, r));

  drawLine(ctx, {
    x: 0,
    y,
    points: [0, 0, containerWidth, 0],
    stroke: cellLineColor,
  });
};

export const computeShouldRerender = (current: ILayoutDrawerProps, last?: ILayoutDrawerProps) => {
  if (last == null) return true;
  return !(
    current.theme === last.theme &&
    current.columns === last.columns &&
    current.getLinearRow === last.getLinearRow &&
    current.real2RowIndex === last.real2RowIndex &&
    current.getCellContent === last.getCellContent &&
    current.coordInstance === last.coordInstance &&
    current.visibleRegion === last.visibleRegion &&
    current.forceRenderFlag === last.forceRenderFlag &&
    current.hoverCellPosition === last.hoverCellPosition
  );
};

export const drawCacheContent = (
  cacheCanvas: HTMLCanvasElement | undefined,
  props: ICacheDrawerProps
) => {
  if (!cacheCanvas) return;

  const { containerWidth, containerHeight, pixelRatio, shouldRerender, draw } = props;
  const width = Math.ceil(containerWidth * pixelRatio);
  const height = Math.ceil(containerHeight * pixelRatio);

  if (cacheCanvas.width !== width || cacheCanvas.height !== height) {
    cacheCanvas.width = width;
    cacheCanvas.height = height;
  }

  const cacheCtx = cacheCanvas.getContext('2d');
  if (cacheCtx == null) return;

  if (shouldRerender) {
    cacheCtx.clearRect(0, 0, width, height);
    cacheCtx.save();

    if (pixelRatio !== 1) {
      cacheCtx.scale(pixelRatio, pixelRatio);
    }

    cacheCtx.beginPath();
    cacheCtx.rect(0, 0, containerWidth, containerHeight);
    cacheCtx.clip();
  }

  draw(cacheCtx);

  if (shouldRerender) {
    cacheCtx.restore();
  }
};

export const drawGrid = (
  mainCanvas: HTMLCanvasElement,
  cacheCanvas: HTMLCanvasElement,
  props: ILayoutDrawerProps,
  lastProps?: ILayoutDrawerProps
) => {
  const { coordInstance, scrollState, height: originHeight, columnStatistics } = props;
  const { isScrolling } = scrollState;
  const { containerWidth } = coordInstance;

  if (containerWidth === 0 || originHeight === 0) return;

  const pixelRatio = Math.ceil(window.devicePixelRatio ?? 1);
  const width = Math.ceil(containerWidth * pixelRatio);
  const height = Math.ceil(originHeight * pixelRatio);
  const shouldRerender = isScrolling || computeShouldRerender(props, lastProps);

  if (mainCanvas.width !== width || mainCanvas.height !== height) {
    mainCanvas.width = width;
    mainCanvas.height = height;
    mainCanvas.style.width = containerWidth + 'px';
    mainCanvas.style.height = originHeight + 'px';
  }

  const mainCtx = mainCanvas.getContext('2d');
  if (mainCtx == null) return;

  mainCtx.clearRect(0, 0, width, height);
  mainCtx.save();

  if (pixelRatio !== 1) {
    mainCtx.scale(pixelRatio, pixelRatio);
  }

  mainCtx.beginPath();
  mainCtx.rect(0, 0, containerWidth, originHeight);
  mainCtx.clip();

  drawCacheContent(cacheCanvas, {
    containerWidth,
    containerHeight: originHeight,
    pixelRatio,
    shouldRerender,
    draw: (cacheCtx) => {
      drawCells(mainCtx, cacheCtx, { ...props, shouldRerender });
    },
  });

  mainCtx.save();
  mainCtx.setTransform(1, 0, 0, 1, 0, 0);
  mainCtx.drawImage(cacheCanvas, 0, 0, width, height);
  mainCtx.restore();

  drawColumnHeadersRegion(mainCtx, props);

  drawFreezeRegionDivider(mainCtx, props, DividerRegion.Top);

  drawCollaborators(mainCtx, props);

  drawSearchTargetIndex(mainCtx, props);

  drawSearchCursor(mainCtx, props);

  drawActiveCell(mainCtx, props);

  drawColumnStatisticsRegion(mainCtx, props);

  columnStatistics != null && drawFreezeRegionDivider(mainCtx, props, DividerRegion.Bottom);

  // TODO: Grid Filling Functionality Supplement
  // drawFillHandler(mainCtx, props);

  drawColumnResizeHandler(mainCtx, props);

  drawRowDraggingRegion(mainCtx, props);

  drawColumnDraggingRegion(mainCtx, props);

  drawColumnFreezeHandler(mainCtx, props);

  setVisibleImageRegion(props);

  mainCtx.restore();
};
