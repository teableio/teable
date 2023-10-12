/* eslint-disable @typescript-eslint/naming-convention */
import { GRID_DEFAULT } from '../../configs';
import type { IRectangle } from '../../interface';
import { measuredCanvas } from '../../utils';
import type { ITextInfo } from '../base-renderer';
import { drawLine, drawMultiLineText } from '../base-renderer';
import { CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  ILinkCell,
  ICellClickProps,
} from './interface';

interface ITextPosition {
  x: number;
  y: number;
  key: string;
  text: string;
  link: string;
  width: number;
}

interface IComputeTextPositionProps {
  data: string[];
  bound: IRectangle;
  getTextInfos: (text: string) => ITextInfo[];
}

const { cellHorizontalPadding, cellVerticalPadding, cellTextLineHeight } = GRID_DEFAULT;

const computeTextPositions = ({
  data,
  bound,
  getTextInfos,
}: IComputeTextPositionProps): ITextPosition[] => {
  const positions: ITextPosition[] = [];
  const { height } = bound;
  let x = bound.x;
  let y = bound.y;
  let row = 1;
  const maxRowCount = Math.max(
    1,
    Math.floor((height - cellTextLineHeight) / cellTextLineHeight) + 1
  );

  let index = 0;

  for (const text of data) {
    const textLines = getTextInfos(text);

    for (const { text: lineText, width: textWidth } of textLines) {
      if (row > maxRowCount) break;

      positions.push({ text: lineText, x, y, width: textWidth, link: text, key: String(index) });

      row++;
      y += cellTextLineHeight;
      x = bound.x;
    }

    index++;
  }

  return positions;
};

const getClickedRegionDetails = (cell: ILinkCell, props: ICellClickProps) => {
  const { hoverCellPosition, width, height, theme } = props;
  const [hoverX, hoverY] = hoverCellPosition;
  const { fontSizeSM } = theme;
  const { data } = cell;

  if (measuredCanvas == null) return { link: null, valid: false };

  const { ctx, setFontSize } = measuredCanvas;

  if (!ctx) return { link: null, valid: false };

  const bound: IRectangle = {
    x: cellHorizontalPadding,
    y: cellVerticalPadding,
    width: width - 2 * cellHorizontalPadding,
    height: height - cellVerticalPadding,
  };

  setFontSize(fontSizeSM);

  const textPositions = computeTextPositions({
    data,
    bound,
    getTextInfos: (text) =>
      drawMultiLineText(ctx, {
        text,
        maxLines: Math.floor(bound.height / cellTextLineHeight),
        maxWidth: bound.width,
        fontSize: fontSizeSM,
        needRender: false,
      }),
  });

  for (const position of textPositions) {
    const { x, y, width, link } = position;
    if (hoverX >= x && hoverX <= x + width && hoverY >= y && hoverY <= y + cellTextLineHeight) {
      return { link, valid: true };
    }
  }
  return { link: null, valid: false };
};

export const linkCellRenderer: IInternalCellRenderer<ILinkCell> = {
  type: CellType.Link,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: ILinkCell, props: ICellRenderProps) => {
    const { ctx, rect, theme, hoverCellPosition } = props;
    const { data } = cell;
    const { x: originX, y: originY, width, height } = rect;
    const [hoverX, hoverY] = hoverCellPosition || [-1, -1];
    const { fontSizeSM, cellTextColorHighlight } = theme;

    const bound: IRectangle = {
      x: originX + cellHorizontalPadding,
      y: originY + cellVerticalPadding,
      width: width - 2 * cellHorizontalPadding,
      height: height - cellVerticalPadding,
    };

    ctx.save();
    ctx.beginPath();

    if (data.length) {
      ctx.rect(originX, originY, width, height);
      ctx.clip();
    }

    const textPositions = computeTextPositions({
      data,
      bound,
      getTextInfos: (text) =>
        drawMultiLineText(ctx, {
          text,
          fill: cellTextColorHighlight,
          maxLines: Math.floor(bound.height / cellTextLineHeight),
          maxWidth: bound.width,
          needRender: false,
          fontSize: fontSizeSM,
        }),
    });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cellTextColorHighlight;

    let hoveredLink = '';
    let hoveredKey = '';
    const offsetY = fontSizeSM / 2;

    textPositions.forEach((position) => {
      const { x, y, width, text, link, key } = position;
      const isHovered =
        hoverX >= cellHorizontalPadding &&
        hoverX <= cellHorizontalPadding + width &&
        hoverY >= y - originY &&
        hoverY <= y - originY + cellTextLineHeight;

      if (isHovered) {
        hoveredLink = link;
        hoveredKey = key;
      }

      ctx.fillText(text, x, y + offsetY);
    });

    if (hoveredLink) {
      textPositions.forEach((position) => {
        const { x, y, width, key } = position;

        if (key === hoveredKey) {
          drawLine(ctx, {
            x,
            y,
            points: [0, fontSizeSM - 1, width, fontSizeSM - 1],
            stroke: cellTextColorHighlight,
          });
        }
      });
    }

    ctx.restore();
  },
  checkWithinBound: (cell: ILinkCell, props: ICellClickProps) => {
    return getClickedRegionDetails(cell, props).valid;
  },
  onClick: (cell: ILinkCell, props: ICellClickProps) => {
    const link = getClickedRegionDetails(cell, props).link;

    if (link == null) return;

    cell.onClick(link);
  },
};
