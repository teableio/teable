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
});
