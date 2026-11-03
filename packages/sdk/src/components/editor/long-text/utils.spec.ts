import { describe, expect, it } from 'vitest';
import { stripMarkdown } from './utils';

const url = 'http://example.com/base/table/view';

describe('long text markdown utils', () => {
  it('keeps autolink URLs visible when stripping markdown', () => {
    expect(stripMarkdown(`123<${url}>`)).toBe(`123${url}`);
  });

  it('keeps escaped autolink URLs visible when stripping markdown', () => {
    expect(stripMarkdown(`123\\<${url.replace(':', '\\:')}>`)).toBe(`123${url}`);
  });

  it('keeps angle-wrapped markdown link URLs visible when stripping markdown', () => {
    expect(stripMarkdown(`123<[${url}](${url})>`)).toBe(`123${url}`);
  });

  it('keeps escaped angle-wrapped markdown link URLs visible when stripping markdown', () => {
    expect(stripMarkdown(`123\\<[${url}](${url})>`)).toBe(`123${url}`);
  });

  // T2776: the grid cell wraps, so the markdown preview must keep the list's lines
  it('keeps one list item per line for the grid cell preview', () => {
    const value = [
      '1. new changelog preparation',
      '2. changelog UI update',
      '   <https://help.teable.ai/en/basic/ai/overview>',
      '3. Appsumo countdown time determined:',
      '',
      '* Thursday, April 9, at 7:00 AM PT',
      '',
      '- 北京时间 4 月 9 日 **10pm**',
    ].join('\n');
    expect(stripMarkdown(value, { keepLines: true })).toBe(
      [
        '1. new changelog preparation',
        '2. changelog UI update',
        'https://help.teable.ai/en/basic/ai/overview',
        '3. Appsumo countdown time determined:',
        '• Thursday, April 9, at 7:00 AM PT',
        '• 北京时间 4 月 9 日 10pm',
      ].join('\n')
    );
  });

  it('keeps plain numbered lines as separate lines', () => {
    const value = '1，更新公司余额\n2.新员工入职\n3.申报1季度公司增值税';
    expect(stripMarkdown(value, { keepLines: true })).toBe(value);
  });

  it('still flattens to one line without keepLines', () => {
    expect(stripMarkdown('1. a\n2. b')).toBe('a b');
  });
});
