import { renderToString } from 'react-dom/server';
import { Rectangles } from '../Rectangles';

describe('Rectangles', () => {
  const buildMarkup = () =>
    renderToString(<Rectangles amount={24} className="size-10 rounded-md" />);

  it('renders identical markup on repeat renders so SSR and hydration agree', () => {
    expect(buildMarkup()).toBe(buildMarkup());
  });

  it('keeps animation durations within a precision the browser serializes verbatim', () => {
    const view = buildMarkup();
    const durations = [...view.matchAll(/pulse ([\d.]+)s/g)].map(([, value]) => value);

    expect(durations).toHaveLength(24);
    for (const value of durations) {
      // More than 3 decimals get truncated when the style attribute is
      // re-read during hydration, which React reports as a mismatch.
      expect(value).toMatch(/^\d+(\.\d{1,3})?$/);
    }
  });
});
