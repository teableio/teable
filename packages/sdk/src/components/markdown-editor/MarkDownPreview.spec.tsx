/**
 * Regression guard for GHSA-75j7-974w-84gf: stored XSS through markdown that
 * is rendered with raw HTML enabled (plugin and template descriptions, the API
 * guide). The preview keeps rehype-raw so descriptions can use simple HTML,
 * and sanitises the result so scripts, frames and event handlers never reach
 * the DOM.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './MarkDownPreview';

describe('MarkdownPreview sanitisation', () => {
  it('drops a script smuggled through inline svg', () => {
    const { container } = render(
      <MarkdownPreview>{'<svg><script>window.__xss = 1</script></svg>'}</MarkdownPreview>
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('__xss');
  });

  it('drops an iframe with srcdoc', () => {
    const { container } = render(
      <MarkdownPreview>
        {'<iframe srcdoc="<script>window.__xss = 1</script>"></iframe>'}
      </MarkdownPreview>
    );

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('srcdoc');
  });

  it('strips event handlers from an image', () => {
    const { container } = render(
      <MarkdownPreview>{'<img src=x onerror="window.__xss = 1">'}</MarkdownPreview>
    );

    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('__xss');
  });

  it('keeps markdown formatting', () => {
    const { container } = render(<MarkdownPreview>{'**bold**'}</MarkdownPreview>);

    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('keeps a GFM table', () => {
    const { container } = render(
      <MarkdownPreview>{'| a | b |\n| --- | --- |\n| 1 | 2 |'}</MarkdownPreview>
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('keeps safe inline html', () => {
    const { container } = render(<MarkdownPreview>{'<b>inline</b>'}</MarkdownPreview>);

    expect(container.querySelector('b')?.textContent).toBe('inline');
  });

  it('keeps an https image', () => {
    const { container } = render(
      <MarkdownPreview>{'<img src="https://example.com/a.png" alt="a">'}</MarkdownPreview>
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
  });
});
