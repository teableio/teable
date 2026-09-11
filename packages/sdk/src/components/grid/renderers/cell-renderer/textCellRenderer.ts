import type { IUrlMatch } from '../../../../utils/find-urls';
import { resolveContentDirection } from '../../../../utils/text-direction';
import { GRID_DEFAULT } from '../../configs';
import { isPointInsideRectangle, measuredCanvas } from '../../utils';
import {
  TEXT_ELLIPSIS,
  drawMultiLineText,
  drawSingleLineText,
} from '../base-renderer/baseRenderer';
import { CellRegionType, CellType } from './interface';
import type {
  IInternalCellRenderer,
  ITextCell,
  ICellRenderProps,
  ICellMeasureProps,
  ICellClickProps,
  ICellClickCallback,
} from './interface';

const { maxRowCount, cellHorizontalPadding, cellVerticalPaddingMD, cellTextLineHeight } =
  GRID_DEFAULT;

interface ITextSegment {
  // Position relative to the cell origin
  x: number;
  y: number;
  width: number;
  text: string;
  // Set when the segment is part of a detected link
  link?: IUrlMatch;
}

interface IComputeSegmentsProps {
  ctx: CanvasRenderingContext2D;
  text: string;
  links: IUrlMatch[];
  width: number;
  height: number;
  fontSize: number;
  isActive?: boolean;
}

const getMaxLines = (height: number, isActive?: boolean) =>
  isActive
    ? Infinity
    : Math.max(Math.floor((height - cellVerticalPaddingMD) / cellTextLineHeight), 1);

// Lays the text out with the shared wrapper, then splits every wrapped line at
// link boundaries so links can be drawn in their own color and hit-tested.
// Right-to-left content mirrors the plain rendering: segments are placed from
// the line's right edge in logical order, and each segment reorders its own
// characters when drawn.
const computeSegments = (props: IComputeSegmentsProps): ITextSegment[] => {
  const { ctx, text, links, width, height, fontSize, isActive } = props;
  const lines = drawMultiLineText(ctx, {
    text,
    maxLines: getMaxLines(height, isActive),
    lineHeight: cellTextLineHeight,
    maxWidth: width - cellHorizontalPadding * 2,
    needRender: false,
  });
  const isRtl = resolveContentDirection(text) === 'rtl';
  const lineRight = width - cellHorizontalPadding;
  const segments: ITextSegment[] = [];
  // Links and lines are both ordered by source offset, so one cursor walks the
  // links instead of scanning the whole list for every line
  let linkIndex = 0;

  lines.forEach((line, row) => {
    const { text: lineText, start: lineStart } = line;
    // A truncated line carries a trailing ellipsis that is not part of the text
    const isTruncated = !text.startsWith(lineText, lineStart);
    const coreLength = isTruncated ? lineText.length - TEXT_ELLIPSIS.length : lineText.length;
    const lineEnd = lineStart + coreLength;
    const y = cellVerticalPaddingMD + row * cellTextLineHeight;
    let segmentStart = 0;
    let offset = 0;

    const pushSegment = (end: number, link?: IUrlMatch) => {
      if (end <= segmentStart) return;
      const segmentText = lineText.slice(segmentStart, end);
      const { width: segmentWidth } = drawSingleLineText(ctx, {
        text: segmentText,
        fontSize,
        needRender: false,
      });
      const x = isRtl ? lineRight - offset - segmentWidth : cellHorizontalPadding + offset;
      segments.push({ x, y, width: segmentWidth, text: segmentText, link });
      offset += segmentWidth;
      segmentStart = end;
    };

    while (linkIndex < links.length && links[linkIndex].end <= lineStart) linkIndex++;
    // A link that continues past this line stays under the cursor for the next one
    for (let i = linkIndex; i < links.length && links[i].start < lineEnd; i++) {
      const link = links[i];
      pushSegment(Math.max(link.start - lineStart, 0));
      pushSegment(Math.min(link.end - lineStart, coreLength), link);
    }
    pushSegment(lineText.length);
  });

  return segments;
};

const findHoveredLink = (segments: ITextSegment[], hoverX: number, hoverY: number) =>
  segments.find(
    ({ x, y, width, link }) =>
      link != null &&
      isPointInsideRectangle([hoverX, hoverY], [x, y], [x + width, y + cellTextLineHeight])
  )?.link;

export const textCellRenderer: IInternalCellRenderer<ITextCell> = {
  type: CellType.Text,
  needsHoverPosition: (cell: ITextCell) => Boolean(cell.links?.length),
  measure: (cell: ITextCell, props: ICellMeasureProps) => {
    const { displayData } = cell;
    const { ctx, theme, width, height } = props;
    const { cellTextColor, fontSizeSM, fontFamily } = theme;

    if (!displayData) {
      return { width, height, totalHeight: height };
    }

    ctx.font = `${fontSizeSM}px ${fontFamily}`;

    const lineCount = drawMultiLineText(ctx, {
      text: displayData,
      maxLines: Infinity,
      lineHeight: cellTextLineHeight,
      maxWidth: width - cellHorizontalPadding * 2,
      fill: cellTextColor,
      needRender: false,
    }).length;

    const totalHeight = cellVerticalPaddingMD + lineCount * cellTextLineHeight;
    const displayRowCount = Math.min(maxRowCount, lineCount);

    return {
      width,
      height: Math.max(height, cellVerticalPaddingMD + displayRowCount * cellTextLineHeight),
      totalHeight,
    };
  },
  draw: (cell: ITextCell, props: ICellRenderProps) => {
    const { displayData, links } = cell;
    const { ctx, rect, theme, isActive, hoverCellPosition } = props;
    const { x, y, width, height } = rect;

    if (!displayData) return;

    const { cellTextColor, cellTextColorHighlight, fontSizeSM } = theme;

    if (!links?.length) {
      drawMultiLineText(ctx, {
        x: x + cellHorizontalPadding,
        y: y + cellVerticalPaddingMD,
        text: displayData,
        maxLines: getMaxLines(height, isActive),
        lineHeight: cellTextLineHeight,
        maxWidth: width - cellHorizontalPadding * 2,
        fill: cellTextColor,
      });
      return;
    }

    const segments = computeSegments({
      ctx,
      text: displayData,
      links,
      width,
      height,
      fontSize: fontSizeSM,
      isActive,
    });
    const hoveredLink = hoverCellPosition
      ? findHoveredLink(segments, hoverCellPosition[0], hoverCellPosition[1])
      : undefined;

    segments.forEach((segment) => {
      const { link, text } = segment;
      drawSingleLineText(ctx, {
        x: x + segment.x,
        y: y + segment.y,
        text,
        fontSize: fontSizeSM,
        fill: link ? cellTextColorHighlight : cellTextColor,
        isUnderline: link != null && link === hoveredLink,
      });
    });
  },
  checkRegion: (cell: ITextCell, props: ICellClickProps, _shouldCalculate?: boolean) => {
    const { displayData, links } = cell;
    const { hoverCellPosition, width, height, isActive, theme, activeCellBound } = props;

    if (!links?.length || measuredCanvas == null) {
      return { type: CellRegionType.Blank };
    }

    const { ctx, setFontSize } = measuredCanvas;
    if (!ctx) return { type: CellRegionType.Blank };
    setFontSize(theme.fontSizeSM);

    const [hoverX, hoverY] = hoverCellPosition;
    // activeCellBound describes the active cell even while hit-testing others
    const scrollTop = isActive ? activeCellBound?.scrollTop ?? 0 : 0;
    const segments = computeSegments({
      ctx,
      text: displayData,
      links,
      width,
      height,
      fontSize: theme.fontSizeSM,
      isActive,
    });
    const hoveredLink = findHoveredLink(segments, hoverX, hoverY + scrollTop);

    return hoveredLink
      ? { type: CellRegionType.Preview, data: hoveredLink.url }
      : { type: CellRegionType.Blank };
  },
  onClick: (cell: ITextCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const cellRegion = textCellRenderer.checkRegion?.(cell, props, true);
    if (cellRegion?.type !== CellRegionType.Preview) return;
    cell.onLinkClick?.(cellRegion.data as string);
    // Lets the touch layer know a link was tapped so it does not also activate the cell
    callback(cellRegion);
  },
};
