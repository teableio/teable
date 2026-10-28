import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageManager } from './ImageManager';

type Listener = () => void;

const assignedSrcs: string[] = [];

// happy-dom never fetches images, so drive load/error from the url itself.
class FakeImage {
  width = 10;
  height = 10;
  private listeners: Record<string, Listener[]> = {};

  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  set src(value: string) {
    assignedSrcs.push(value);
    // Browsers fire `error` for an empty src too.
    const outcome = !value || value.includes('broken') ? 'error' : 'load';
    setTimeout(() => {
      const listeners = this.listeners[outcome] ?? [];
      this.listeners[outcome] = [];
      listeners.forEach((listener) => listener());
    }, 0);
  }

  decode() {
    return Promise.resolve();
  }
}

describe('ImageManager', () => {
  const originalImage = globalThis.Image;

  beforeEach(() => {
    globalThis.Image = FakeImage as unknown as typeof Image;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.unstubAllGlobals();
  });

  it('tells a failed load apart from one still in flight, and redraws its cells', async () => {
    const manager = new ImageManager();
    const settled = vi.fn();
    manager.setCallback(settled);
    const url = 'https://example.com/broken.png';

    expect(manager.loadOrGetImage(url, 1, 2)).toBeUndefined();
    expect(manager.hasFailed(url)).toBe(false);

    await vi.waitFor(() => expect(manager.hasFailed(url)).toBe(true));
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith([[1, 2]]));
    // A failed url is not retried while its entry lives.
    expect(manager.loadOrGetImage(url, 1, 2)).toBeUndefined();
  });

  it('hands out the image once it has loaded', async () => {
    const manager = new ImageManager();
    manager.setCallback(vi.fn());
    const url = 'https://example.com/ok.png';

    expect(manager.loadOrGetImage(url, 0, 0)).toBeUndefined();
    await vi.waitFor(() => expect(manager.loadOrGetImage(url, 0, 0)).toBeInstanceOf(FakeImage));
    expect(manager.hasFailed(url)).toBe(false);
  });

  it('drops a load evicted before its frame without fetching or an unhandled rejection', async () => {
    // Frames come after already queued tasks, like the `error` an empty src fires.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 16)
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const manager = new ImageManager();
      manager.setCallback(vi.fn());
      manager.setWindow({ x: 0, y: 0, width: 5, height: 20 }, 0);
      for (let row = 0; row < 14; row++) {
        manager.loadOrGetImage(`https://example.com/${row}.png`, 0, row);
      }
      await vi.waitFor(() =>
        expect(manager.loadOrGetImage('https://example.com/13.png', 0, 13)).toBeInstanceOf(
          FakeImage
        )
      );
      // Scrolling rows 0-12 away fills the shared pool.
      manager.setWindow({ x: 0, y: 13, width: 5, height: 20 }, 0);

      // The active cell is drawn even when scrolled away, then evicted by the same draw;
      // with the pool full, cancel() empties src and the element fires `error`.
      const evictedUrl = 'https://example.com/active.png';
      manager.loadOrGetImage(evictedUrl, 0, 0);
      manager.setWindow({ x: 0, y: 40, width: 5, height: 20 }, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(unhandled).toEqual([]);
      expect(assignedSrcs).not.toContain(evictedUrl);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
