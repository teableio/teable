import { describe, expect, it } from 'vitest';
import { getPluginFrameOrigin } from './plugin-frame-origin';

const page = 'https://app.example.com/base/bse1/dashboard';

describe('getPluginFrameOrigin', () => {
  it('resolves a relative plugin url against the page', () => {
    expect(getPluginFrameOrigin('/plugin/sheet-form-view?lang=en', page)).toBe(
      'https://app.example.com'
    );
  });

  it('returns the origin of an absolute plugin url', () => {
    expect(getPluginFrameOrigin('https://plugin.example.net/widget?x=1', page)).toBe(
      'https://plugin.example.net'
    );
    expect(getPluginFrameOrigin('http://127.0.0.1:9999/poc', page)).toBe('http://127.0.0.1:9999');
  });

  it('drops a default port the way the browser reports a message origin', () => {
    expect(getPluginFrameOrigin('https://plugin.example.net:443/widget', page)).toBe(
      'https://plugin.example.net'
    );
  });

  it.each([
    'javascript:alert(1)//',
    'data:text/html,<script>parent.postMessage(1, "*")</script>',
    'blob:https://app.example.com/5f0c3c1e-0000-4000-8000-000000000000',
    'file:///etc/hostname',
    'http://',
  ])('has no origin for %s', (src) => {
    expect(getPluginFrameOrigin(src, page)).toBeUndefined();
  });
});
