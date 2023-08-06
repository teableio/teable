import { isEqual } from 'lodash';
import { GRID_DEFAULT, ROW_RELATED_REGIONS } from '../../configs';
import { getDropTargetIndex } from '../../hooks';
import type { IRectangle } from '../../interface';
import { DragRegionType, RegionType, RowControlType } from '../../interface';
import { checkIfRowOrCellActive, checkIfRowOrCellSelected, calculateMaxRange } from '../../utils';
import {
  drawCheckbox,
  drawLine,
  drawRect,
  drawRoundPoly,
  drawSingleLineText,
} from '../base-renderer';
import { getCellRenderer } from '../cell-renderer';
import type {
  ICacheDrawerProps,
  ICellDrawerProps,
  IFieldHeadDrawerProps,
  IGridHeaderDrawerProps,
  ILayoutDrawerProps,
  IRowHeaderDrawerProps,
} from './interface';
import { RenderRegion } from './interface';

const spriteIconMap = {
  [RowControlType.Drag]: 'dragIcon',
  [RowControlType.Expand]: 'expandIcon',
};

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
    isActive,
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
      width,
      height,
    },
    rowIndex,
    columnIndex,
    imageManager,
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
    isRowAppendEnable,
    getCellContent,
    theme,
    imageManager,
    spriteManager,
  } = props;
  const {
    startRowIndex,
    stopRowIndex: originStopRowIndex,
    startColumnIndex: originStartColumnIndex,
    stopColumnIndex: originStopColumnIndex,
  } = visibleRegion;
  const { rowHeight, freezeColumnCount, columnInitSize } = coordInstance;
  const { isRowSelection, isColumnSelection } = selection;
  const { scrollLeft, scrollTop } = scrollState;
  const isFreezeRegion = renderRegion === RenderRegion.Freeze;
  const { rowIndex: hoverRowIndex, type: hoverRegionType, isOutOfBounds } = mouseState;
  const startColumnIndex = isFreezeRegion ? 0 : Math.max(freezeColumnCount, originStartColumnIndex);
  const stopColumnIndex = isFreezeRegion
    ? Math.max(freezeColumnCount - 1, 0)
    : originStopColumnIndex;
  const stopRowIndex = isRowAppendEnable ? Math.max(0, originStopRowIndex - 1) : originStopRowIndex;
  const { cellBg, cellBgHovered, cellBgSelected } = theme;

  const cellPropList: ICellDrawerProps[] = [];
  const rowHeaderPropList = [];

  for (let columnIndex = startColumnIndex; columnIndex <= stopColumnIndex; columnIndex++) {
    const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const columnWidth = coordInstance.getColumnWidth(columnIndex);
    const isColumnActive = isColumnSelection && selection.includes([columnIndex, columnIndex]);
    const isFirstColumn = columnIndex === 0;

    for (let rowIndex = startRowIndex; rowIndex <= stopRowIndex; rowIndex++) {
      const y = coordInstance.getRowOffset(rowIndex) - scrollTop;
      const isHover =
        !isOutOfBounds &&
        !isSelecting &&
        ROW_RELATED_REGIONS.has(hoverRegionType) &&
        rowIndex === hoverRowIndex;
      const { isCellActive, isRowActive } = checkIfRowOrCellActive(
        activeCell,
        rowIndex,
        columnIndex
      );
      const { isRowSelected, isCellSelected } = checkIfRowOrCellSelected(
        selection,
        rowIndex,
        columnIndex
      );
      let fill;

      if (isCellSelected || isRowSelected || isColumnActive) {
        fill = cellBgSelected;
      } else if (isHover || isRowActive) {
        fill = cellBgHovered;
      }

      if (isFirstColumn) {
        rowHeaderPropList.push({
          x: 0.5,
          y: y + 0.5,
          width: columnInitSize,
          height: rowHeight,
          displayIndex: String(rowIndex + 1),
          isHover: isHover || isRowActive,
          isChecked: isRowSelection && isRowSelected,
          rowControls,
          theme,
          spriteManager,
        });
      }

      cellPropList.push({
        x: isFirstColumn ? x : x + 0.5,
        y: y + 0.5,
        width: isFirstColumn ? columnWidth + 0.5 : columnWidth,
        height: rowHeight,
        rowIndex,
        columnIndex,
        getCellContent,
        imageManager,
        theme,
        fill: isCellActive ? cellBg : fill,
      });
    }
  }

  return {
    cellPropList,
    rowHeaderPropList,
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
  const { pureRowCount, rowInitSize, freezeRegionWidth, containerWidth, containerHeight } =
    coordInstance;

  if (pureRowCount === 0) return;

  const { cellPropList: otherCellPropList } = calcCells(props, RenderRegion.Other);
  const { cellPropList: freezeCellPropList, rowHeaderPropList } = calcCells(
    props,
    RenderRegion.Freeze
  );

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

export const drawActiveCell = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const { coordInstance, activeCell, scrollState, getCellContent, imageManager, theme } = props;
  const { scrollTop, scrollLeft } = scrollState;
  const { freezeColumnCount, freezeRegionWidth, rowInitSize, containerWidth, containerHeight } =
    coordInstance;

  if (activeCell == null) return;
  const { cellBg, cellLineColorActived, fontSizeSM, fontFamily } = theme;
  const [columnIndex, rowIndex] = activeCell;
  const isFreezeRegion = columnIndex < freezeColumnCount;
  const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
  const y = coordInstance.getRowOffset(rowIndex) - scrollTop;
  const width = coordInstance.getColumnWidth(columnIndex);
  const height = coordInstance.getRowHeight(rowIndex);

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

  drawCellContent(ctx, {
    x: x + 0.5,
    y: y + 0.5,
    width: width,
    height: height,
    rowIndex,
    columnIndex,
    getCellContent,
    isActive: true,
    imageManager,
    theme,
  });

  ctx.restore();
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
  const { fillHandlerSize } = GRID_DEFAULT;
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
  const { rowHeadIconPaddingTop, cellVerticalPadding } = GRID_DEFAULT;

  if (isChecked || isHover) {
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
        spriteManager.drawSprite(ctx, {
          sprite: icon || spriteIconMap[type],
          x: x + offsetX - halfSize,
          y: y + rowHeadIconPaddingTop,
          size: iconSizeXS,
          theme,
        });
      }
    }
    return;
  }
  drawSingleLineText(ctx, {
    x: x + width / 2,
    y: y + cellVerticalPadding + 1,
    text: displayIndex,
    textAlign: 'center',
    fill: rowHeaderTextColor,
  });
};

export const drawColumnHeader = (ctx: CanvasRenderingContext2D, props: IFieldHeadDrawerProps) => {
  const { x, y, width, height, theme, fill, column, hasMenu, spriteManager } = props;
  const { name, icon, hasMenu: hasColumnMenu } = column;
  const {
    cellLineColor,
    columnHeaderBg,
    iconBgCommon,
    columnHeaderNameColor,
    fontSizeSM,
    iconSizeXS,
  } = theme;
  const { columnHeadPadding, columnHeadMenuSize, cellVerticalPadding } = GRID_DEFAULT;
  let maxTextWidth = width - columnHeadPadding * 2 - iconSizeXS;

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
  icon &&
    spriteManager.drawSprite(ctx, {
      sprite: icon,
      x: x + columnHeadPadding,
      y: y + (height - iconSizeXS) / 2,
      size: iconSizeXS,
      theme,
    });
  if (hasMenu && hasColumnMenu) {
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
      fill: iconBgCommon,
    });
  }
  drawSingleLineText(ctx, {
    x: x + iconSizeXS + columnHeadPadding + columnHeadPadding / 2,
    y: y + cellVerticalPadding,
    text: name,
    fill: columnHeaderNameColor,
    fontSize: fontSizeSM,
    maxWidth: maxTextWidth,
  });
};

export const drawGridHeader = (ctx: CanvasRenderingContext2D, props: IGridHeaderDrawerProps) => {
  const { x, y, width, height, theme, rowControls, isChecked } = props;
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

  if (rowControls.some((item) => item.type === RowControlType.Checkbox)) {
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
    dragState,
    mouseState,
    scrollState,
    selection,
    rowControls,
    isRowAppendEnable,
    isColumnHeaderMenuVisible,
  } = props;
  const { startColumnIndex: originStartColumnIndex, stopColumnIndex: originStopColumnIndex } =
    visibleRegion;
  const {
    containerWidth,
    freezeRegionWidth,
    rowInitSize,
    columnInitSize,
    freezeColumnCount,
    rowCount,
  } = coordInstance;
  const { scrollLeft } = scrollState;
  const { isDragging } = dragState;
  const { isColumnSelection, isRowSelection, ranges: selectionRanges } = selection;
  const { type: hoverRegionType, columnIndex: hoverColumnIndex } = mouseState;
  const isFreezeRegion = renderRegion === RenderRegion.Freeze;
  const startColumnIndex = isFreezeRegion ? 0 : Math.max(freezeColumnCount, originStartColumnIndex);
  const stopColumnIndex = isFreezeRegion
    ? Math.max(freezeColumnCount - 1, 0)
    : originStopColumnIndex;
  const endRowIndex = isRowAppendEnable ? rowCount - 2 : rowCount - 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    isFreezeRegion ? 0 : freezeRegionWidth + 1,
    0,
    isFreezeRegion ? freezeRegionWidth + 1 : containerWidth - freezeRegionWidth,
    rowInitSize + 1
  );
  ctx.clip();
  const { fontSizeMD, fontFamily, columnHeaderBg, columnHeaderBgHovered, columnHeaderBgSelected } =
    theme;
  ctx.font = `normal ${fontSizeMD}px ${fontFamily}`;

  for (let columnIndex = startColumnIndex; columnIndex <= stopColumnIndex; columnIndex++) {
    const x = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);
    const columnWidth = coordInstance.getColumnWidth(columnIndex);
    const isActive = isColumnSelection && selection.includes([columnIndex, columnIndex]);
    const isHover =
      !isDragging &&
      [RegionType.ColumnHeader, RegionType.ColumnHeaderMenu].includes(hoverRegionType) &&
      hoverColumnIndex === columnIndex;
    let fill = columnHeaderBg;

    if (columnIndex === 0) {
      const isChecked = isRowSelection && isEqual(selectionRanges[0], [0, endRowIndex]);
      drawGridHeader(ctx, {
        x: 0.5,
        y: 0.5,
        width: columnInitSize + 1,
        height: rowInitSize,
        theme,
        rowControls,
        isChecked,
      });
    }

    if (isActive) {
      fill = columnHeaderBgSelected;
    } else if (isHover) {
      fill = columnHeaderBgHovered;
    }

    drawColumnHeader(ctx, {
      x: x + 0.5,
      y: 0.5,
      width: columnWidth,
      height: rowInitSize,
      column: columns[columnIndex],
      fill,
      hasMenu: isColumnHeaderMenuVisible,
      theme,
      spriteManager,
    });
  }

  ctx.restore();
};

export const drawAppendRow = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const {
    scrollState,
    coordInstance,
    mouseState,
    theme,
    isRowAppendEnable,
    spriteManager,
    visibleRegion,
  } = props;
  const { stopRowIndex } = visibleRegion;
  const { totalWidth, pureRowCount, columnInitSize } = coordInstance;
  if (!isRowAppendEnable || stopRowIndex < pureRowCount) return;

  const { scrollLeft, scrollTop } = scrollState;
  const { type, rowIndex, isOutOfBounds } = mouseState;
  const { appendRowBg, appendRowBgHovered, iconSizeSM } = theme;
  const halfIconSize = iconSizeSM / 2;
  const isHover = !isOutOfBounds && type === RegionType.AppendRow && rowIndex === pureRowCount;
  const width = totalWidth - scrollLeft;
  const height = coordInstance.getRowHeight(pureRowCount) + 0.5;
  const y = coordInstance.getRowOffset(pureRowCount) - scrollTop;

  ctx.save();
  ctx.beginPath();
  drawRect(ctx, {
    x: 0.5,
    y: y + 0.5,
    width,
    height,
    fill: isHover ? appendRowBgHovered : appendRowBg,
  });
  spriteManager.drawSprite(ctx, {
    sprite: 'addIcon',
    x: columnInitSize / 2 - halfIconSize + 0.5,
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

  const { columnAppendBtnWidth, columnHeadHeight } = GRID_DEFAULT;
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
    sprite: 'addIcon',
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
  const { columnResizeHandlerWidth } = GRID_DEFAULT;
  let x = 0;

  if (isResizing) {
    const columnWidth = coordInstance.getColumnWidth(resizeColumnIndex);
    x = coordInstance.getColumnRelativeOffset(resizeColumnIndex, scrollLeft) + columnWidth;
  } else {
    const realColumnWidth = coordInstance.getColumnWidth(hoveredColumnResizeIndex);
    x =
      coordInstance.getColumnRelativeOffset(hoveredColumnResizeIndex, scrollLeft) + realColumnWidth;
  }
  const paddingTop = 4;

  drawRect(ctx, {
    x: x - columnResizeHandlerWidth / 2 + 0.5,
    y: paddingTop + 0.5,
    width: columnResizeHandlerWidth,
    height: rowInitSize - paddingTop * 2,
    fill: columnResizeHandlerBg,
    radius: 3,
  });
};

export const drawColumnDraggingRegion = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const { columns, theme, mouseState, scrollState, dragState, coordInstance } = props;
  const { columnDraggingPlaceholderBg, cellLineColorActived } = theme;
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

  drawLine(ctx, {
    x: finalX + 0.5,
    y: 0.5,
    points: [0, 0, 0, containerHeight],
    stroke: cellLineColorActived,
  });
};

export const drawRowDraggingRegion = (ctx: CanvasRenderingContext2D, props: ILayoutDrawerProps) => {
  const { theme, mouseState, scrollState, dragState, coordInstance } = props;
  const { columnDraggingPlaceholderBg, cellLineColorActived } = theme;
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

  drawLine(ctx, {
    x: 0.5,
    y: finalY + 0.5,
    points: [0, 0, containerWidth, 0],
    stroke: cellLineColorActived,
  });
};

const setVisibleImageRegion = (props: ILayoutDrawerProps) => {
  const { imageManager, coordInstance, visibleRegion } = props;
  const { startColumnIndex, stopColumnIndex, startRowIndex, stopRowIndex } = visibleRegion;
  const { freezeColumnCount } = coordInstance;
  imageManager?.setWindow(
    {
      x: startColumnIndex,
      y: startRowIndex,
      width: stopColumnIndex - startColumnIndex,
      height: stopRowIndex - startRowIndex,
    },
    freezeColumnCount
  );
};

export const drawFreezeRegionDivider = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  const { theme, coordInstance, scrollState } = props;
  const { cellLineColor } = theme;
  const { scrollLeft } = scrollState;
  const { freezeRegionWidth, containerHeight } = coordInstance;

  if (scrollLeft === 0) return;

  ctx.save();
  ctx.beginPath();

  ctx.shadowColor = cellLineColor;
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 3;
  ctx.strokeStyle = cellLineColor;

  ctx.moveTo(freezeRegionWidth + 0.5, 0);
  ctx.lineTo(freezeRegionWidth + 0.5, containerHeight);
  ctx.stroke();

  ctx.restore();
};

export const drawColumnHeadersRegion = (
  ctx: CanvasRenderingContext2D,
  props: ILayoutDrawerProps
) => {
  [RenderRegion.Freeze, RenderRegion.Other].forEach((r) => drawColumnHeaders(ctx, props, r));
  drawAppendColumn(ctx, props);
};

export const computeShouldRerender = (current: ILayoutDrawerProps, last?: ILayoutDrawerProps) => {
  if (last == null) return true;
  return !(
    current.columns === last.columns &&
    current.getCellContent === last.getCellContent &&
    current.coordInstance === last.coordInstance &&
    current.visibleRegion === last.visibleRegion
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
  const { coordInstance, scrollState } = props;
  const { containerWidth, containerHeight } = coordInstance;
  const { isScrolling } = scrollState;

  if (containerWidth === 0 || containerHeight === 0) return;

  const pixelRatio = Math.ceil(window.devicePixelRatio ?? 1);
  const width = Math.ceil(containerWidth * pixelRatio);
  const height = Math.ceil(containerHeight * pixelRatio);
  const shouldRerender = isScrolling || computeShouldRerender(props, lastProps);

  if (mainCanvas.width !== width || mainCanvas.height !== height) {
    mainCanvas.width = width;
    mainCanvas.height = height;
    mainCanvas.style.width = containerWidth + 'px';
    mainCanvas.style.height = containerHeight + 'px';
  }

  const mainCtx = mainCanvas.getContext('2d');
  if (mainCtx == null) return;

  mainCtx.clearRect(0, 0, width, height);
  mainCtx.save();

  if (pixelRatio !== 1) {
    mainCtx.scale(pixelRatio, pixelRatio);
  }

  mainCtx.beginPath();
  mainCtx.rect(0, 0, containerWidth, containerHeight);
  mainCtx.clip();

  drawAppendRow(mainCtx, props);

  drawCacheContent(cacheCanvas, {
    containerWidth,
    containerHeight,
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

  drawFreezeRegionDivider(mainCtx, props);

  drawActiveCell(mainCtx, props);

  // TODO: Grid Filling Functionality Supplement
  // drawFillHandler(mainCtx, props);

  drawColumnResizeHandler(mainCtx, props);

  drawRowDraggingRegion(mainCtx, props);

  drawColumnDraggingRegion(mainCtx, props);

  setVisibleImageRegion(props);

  mainCtx.restore();
};
