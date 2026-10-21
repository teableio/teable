import { afterEach, describe, expect, it } from 'vitest';
import { setContentDirectionEnabled } from '../../../../utils/text-direction';
import { drawMultiLineText, drawSingleLineText } from './baseRenderer';

// Deterministic additive measureText: CJK 12px, '.' 4px, other ascii 6px
const measure = (text: string) => {
  let width = 0;
  for (const char of text) {
    if (char === '.') width += 4;
    else if (char.charCodeAt(0) > 0xff) width += 12;
    else width += 6;
  }
  return width;
};

const ctx = {
  measureText: (text: string) => ({ width: measure(text) }),
  direction: 'ltr',
} as unknown as CanvasRenderingContext2D;

describe('drawSingleLineText', () => {
  it('returns full text and exact width when it fits', () => {
    const { text, width } = drawSingleLineText(ctx, {
      text: 'hello',
      maxWidth: 100,
      needRender: false,
    });

    expect(text).toBe('hello');
    expect(width).toBe(measure('hello'));
  });

  // Kept width previously could land in (maxWidth - ellipsisWidth, maxWidth],
  // rendering wider than maxWidth while reporting a clamped width
  it.each([
    ['aaaa bbbb cccc', 65],
    ['增长循环计划埋点前置与归因', 111],
  ])('truncates %s to exactly three dots within %dpx', (text, maxWidth) => {
    const result = drawSingleLineText(ctx, { text, maxWidth, needRender: false });

    expect(result.text).toMatch(/[^.]\.{3}$/);
    expect(result.width).toBe(measure(result.text));
    expect(result.width).toBeLessThanOrEqual(maxWidth);
  });

  it('is idempotent when re-truncating its own output', () => {
    const first = drawSingleLineText(ctx, {
      text: 'dddd eeee ffff',
      maxWidth: 65,
      needRender: false,
    });

    // Re-truncating already-ellipsized text used to re-accept old dots one by
    // one ('...' word-segments as three '.') and render 4-5 dots
    const second = drawSingleLineText(ctx, {
      text: first.text,
      maxWidth: 65,
      needRender: false,
    });

    expect(second).toEqual(first);
    expect(second.text).toMatch(/[^.]\.{3}$/);
  });
});

describe('drawSingleLineText content direction', () => {
  afterEach(() => setContentDirectionEnabled(false));

  const ARABIC = 'مرحبا';

  // Records the canvas state as it was at the moment text got painted, since
  // the renderer restores ctx.direction before returning
  const createRecordingCtx = () => {
    const calls: { x: number; textAlign: string; direction: string }[] = [];
    const ctx = {
      measureText: (text: string) => ({ width: measure(text) }),
      direction: 'ltr',
      textAlign: 'left',
      textBaseline: 'middle',
      fillText: (_text: string, x: number) =>
        calls.push({ x, textAlign: ctx.textAlign, direction: ctx.direction }),
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
    } as unknown as CanvasRenderingContext2D & { textAlign: string };
    return { ctx, calls };
  };

  it('leaves RTL content untouched while the gate is off', () => {
    const { ctx, calls } = createRecordingCtx();

    drawSingleLineText(ctx, { text: ARABIC, x: 10, maxWidth: 200 });

    expect(calls).toEqual([{ x: 10, textAlign: 'left', direction: 'ltr' }]);
    expect(ctx.direction).toBe('ltr');
  });

  it('anchors RTL content to the reading edge once enabled', () => {
    setContentDirectionEnabled(true);
    const { ctx, calls } = createRecordingCtx();

    drawSingleLineText(ctx, { text: ARABIC, x: 10, maxWidth: 200 });

    expect(calls).toEqual([{ x: 210, textAlign: 'right', direction: 'rtl' }]);
  });

  it('restores the canvas direction so the next cell is unaffected', () => {
    setContentDirectionEnabled(true);
    const { ctx } = createRecordingCtx();

    drawSingleLineText(ctx, { text: ARABIC, x: 10, maxWidth: 200 });

    expect(ctx.direction).toBe('ltr');
  });

  it('keeps LTR content rendering exactly as before when enabled', () => {
    setContentDirectionEnabled(true);
    const { ctx, calls } = createRecordingCtx();

    drawSingleLineText(ctx, { text: 'hello', x: 10, maxWidth: 200 });

    expect(calls).toEqual([{ x: 10, textAlign: 'left', direction: 'ltr' }]);
  });

  it('respects an explicit alignment instead of following the content', () => {
    setContentDirectionEnabled(true);
    const { ctx, calls } = createRecordingCtx();

    drawSingleLineText(ctx, { text: ARABIC, x: 10, maxWidth: 200, textAlign: 'center' });

    expect(calls[0].textAlign).toBe('center');
    expect(calls[0].x).toBe(10);
  });

  it('appends the ellipsis in logical order so bidi places it at the reading end', () => {
    setContentDirectionEnabled(true);
    const { ctx } = createRecordingCtx();

    const { text } = drawSingleLineText(ctx, {
      text: 'مرحبا مرحبا مرحبا',
      maxWidth: 60,
      needRender: false,
    });

    expect(text).toMatch(/\.{3}$/);
  });
});

describe('drawMultiLineText line offsets', () => {
  const wrap = (text: string, maxWidth: number, maxLines = Infinity) =>
    drawMultiLineText(ctx, { text, maxWidth, maxLines, needRender: false });

  it('reports where each wrapped line starts in the source text', () => {
    const text = 'aaaa bbbb cccc dddd';
    const lines = wrap(text, 60);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach(({ text: lineText, start }) => {
      expect(text.slice(start, start + lineText.length)).toBe(lineText);
    });
    expect(lines[0].start).toBe(0);
  });

  it('skips newline characters between lines', () => {
    const lines = wrap('ab\ncd\n\nef', 1000);
    expect(lines.map(({ text, start }) => [text, start])).toEqual([
      ['ab', 0],
      ['cd', 3],
      ['', 6],
      ['ef', 7],
    ]);
  });

  it('breaks an oversized word per grapheme and keeps offsets contiguous', () => {
    const text = 'abcdefghij';
    const lines = wrap(text, 30);
    expect(lines.map(({ text: lineText }) => lineText).join('')).toBe(text);
    lines.forEach(({ text: lineText, start }) => {
      expect(text.slice(start, start + lineText.length)).toBe(lineText);
    });
  });

  it('keeps the offset of a truncated last line', () => {
    const text = 'aaaa bbbb cccc dddd eeee';
    const [first, last] = wrap(text, 60, 2);
    expect(last.text).toMatch(/\.{3}$/);
    expect(last.start).toBe(first.text.length);
    expect(text.startsWith(last.text.slice(0, -3), last.start)).toBe(true);
  });
});
