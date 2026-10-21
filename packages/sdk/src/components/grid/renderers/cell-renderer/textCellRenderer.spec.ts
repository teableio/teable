import { afterEach, describe, expect, it } from 'vitest';
import { findUrls } from '../../../../utils/find-urls';
import { setContentDirectionEnabled } from '../../../../utils/text-direction';
import { GRID_DEFAULT } from '../../configs';
import type { ICellRenderProps, ITextCell } from './interface';
import { CellType } from './interface';
import { textCellRenderer } from './textCellRenderer';

const { cellHorizontalPadding, cellVerticalPaddingMD } = GRID_DEFAULT;
const CHAR_WIDTH = 10;
const FONT_SIZE = 13;
const theme = {
  cellTextColor: 'black',
  cellTextColorHighlight: 'violet',
  fontSizeSM: FONT_SIZE,
  fontFamily: 'Inter',
} as ICellRenderProps['theme'];

interface IFill {
  text: string;
  x: number;
  y: number;
  color: string;
}

interface IStroke {
  x: number;
  y: number;
  width: number;
}

// Every character is CHAR_WIDTH wide so positions can be asserted exactly
const createCtx = () => {
  const fills: IFill[] = [];
  const strokes: IStroke[] = [];
  let pending: IStroke = { x: 0, y: 0, width: 0 };
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    textAlign: 'left',
    textBaseline: 'middle',
    direction: 'ltr',
    measureText: (text: string) => ({ width: text.length * CHAR_WIDTH }),
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y, color: this.fillStyle });
    },
    moveTo: (x: number, y: number) => {
      pending = { x, y, width: 0 };
    },
    lineTo: (x: number) => {
      pending.width = x - pending.x;
    },
    stroke: () => strokes.push(pending),
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes };
};

const createCell = (displayData: string): ITextCell => ({
  type: CellType.Text,
  data: displayData,
  displayData,
  links: findUrls(displayData),
});

const draw = (
  cell: ITextCell,
  options: { width: number; height: number; hover?: [number, number]; isActive?: boolean }
) => {
  const { ctx, fills, strokes } = createCtx();
  textCellRenderer.draw(cell, {
    ctx,
    theme,
    rect: { x: 0, y: 0, width: options.width, height: options.height },
    hoverCellPosition: options.hover ?? null,
    isActive: options.isActive ?? false,
  } as unknown as ICellRenderProps);
  return { fills, strokes };
};

const firstLineY = cellVerticalPaddingMD + FONT_SIZE / 2;

describe('textCellRenderer with links', () => {
  afterEach(() => setContentDirectionEnabled(false));

  it('only tracks hover position for cells that contain links', () => {
    const needsHoverPosition = textCellRenderer.needsHoverPosition as (cell: ITextCell) => boolean;
    expect(needsHoverPosition(createCell('plain text'))).toBe(false);
    expect(needsHoverPosition(createCell('see https://x.com'))).toBe(true);
  });

  it('draws plain text as a single run when there are no links', () => {
    const { fills } = draw(createCell('plain text'), { width: 400, height: 32 });
    expect(fills).toEqual([
      { text: 'plain text', x: cellHorizontalPadding, y: firstLineY, color: 'black' },
    ]);
  });

  it('splits a line into plain and link runs at the detected url', () => {
    const { fills } = draw(createCell('网址是 https://google.com 哈哈哈'), {
      width: 400,
      height: 32,
    });
    const linkX = cellHorizontalPadding + '网址是 '.length * CHAR_WIDTH;
    expect(fills).toEqual([
      { text: '网址是 ', x: cellHorizontalPadding, y: firstLineY, color: 'black' },
      { text: 'https://google.com', x: linkX, y: firstLineY, color: 'violet' },
      {
        text: ' 哈哈哈',
        x: linkX + 'https://google.com'.length * CHAR_WIDTH,
        y: firstLineY,
        color: 'black',
      },
    ]);
  });

  it('keeps a url highlighted when it wraps across lines', () => {
    const url = 'https://example.com/a/very/long/path';
    // 20 characters fit per line, so the url is split over several lines
    const { fills } = draw(createCell(`see ${url} end`), {
      width: 200 + cellHorizontalPadding * 2,
      height: 120,
    });
    const linkFills = fills.filter((fill) => fill.color === 'violet');
    expect(linkFills.map((fill) => fill.text).join('')).toBe(url);
    expect(new Set(linkFills.map((fill) => fill.y)).size).toBeGreaterThan(1);
    expect(fills.filter((fill) => fill.color === 'black').map((fill) => fill.text)).toEqual([
      'see ',
      ' end',
    ]);
  });

  it('highlights every link of a long list, one per line, in the active cell', () => {
    const urls = Array.from({ length: 40 }, (_, i) => `https://example.com/item/${i}`);
    const { fills } = draw(createCell(urls.join('\n')), { width: 400, height: 32, isActive: true });
    const linkFills = fills.filter((fill) => fill.color === 'violet');
    expect(linkFills.map((fill) => fill.text)).toEqual(urls);
    expect(new Set(linkFills.map((fill) => fill.y)).size).toBe(urls.length);
  });

  it('keeps highlighting links that follow a link wrapped across lines', () => {
    const longUrl = 'https://example.com/a/very/long/path';
    const { fills } = draw(createCell(`see ${longUrl} and https://b.io end`), {
      width: 200 + cellHorizontalPadding * 2,
      height: 120,
    });
    const linkText = fills.filter((fill) => fill.color === 'violet').map((fill) => fill.text);
    expect(linkText.join('')).toBe(`${longUrl}https://b.io`);
  });

  it('draws the ellipsis of a truncated line as plain text', () => {
    const url = 'https://example.com/a/very/long/path';
    const { fills } = draw(createCell(`${url} end here`), {
      width: 200 + cellHorizontalPadding * 2,
      height: 32,
    });
    expect(fills).toHaveLength(2);
    const [link, ellipsis] = fills;
    expect(link.color).toBe('violet');
    expect(url.startsWith(link.text)).toBe(true);
    expect(ellipsis).toMatchObject({ text: '...', color: 'black' });
    expect(ellipsis.x).toBe(link.x + link.text.length * CHAR_WIDTH);
  });

  it('underlines the hovered link and nothing else', () => {
    const cell = createCell('网址是 https://google.com 哈哈哈');
    const linkX = cellHorizontalPadding + '网址是 '.length * CHAR_WIDTH;
    const linkWidth = 'https://google.com'.length * CHAR_WIDTH;

    const hoveredLink = draw(cell, { width: 400, height: 32, hover: [linkX + 5, 15] });
    expect(hoveredLink.strokes).toEqual([
      { x: linkX, y: cellVerticalPaddingMD + FONT_SIZE - 1, width: linkWidth },
    ]);

    const hoveredText = draw(cell, { width: 400, height: 32, hover: [10, 15] });
    expect(hoveredText.strokes).toEqual([]);
  });

  it('places segments from the right edge for right-to-left content', () => {
    setContentDirectionEnabled(true);
    const width = 400;
    const lineRight = width - cellHorizontalPadding;
    const before = 'שלום ';
    const url = 'https://x.com';
    const after = ' עולם';
    const cell = createCell(`${before}${url}${after}`);

    const { fills } = draw(cell, { width, height: 32 });
    const linkX = lineRight - (before.length + url.length) * CHAR_WIDTH;
    expect(fills).toEqual([
      { text: before, x: lineRight - before.length * CHAR_WIDTH, y: firstLineY, color: 'black' },
      { text: url, x: linkX, y: firstLineY, color: 'violet' },
      { text: after, x: linkX - after.length * CHAR_WIDTH, y: firstLineY, color: 'black' },
    ]);

    const hovered = draw(cell, { width, height: 32, hover: [linkX + 5, 15] });
    expect(hovered.strokes).toEqual([
      { x: linkX, y: cellVerticalPaddingMD + FONT_SIZE - 1, width: url.length * CHAR_WIDTH },
    ]);
  });
});
