import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageManager } from './ImageManager';

type Listener = () => void;

// happy-dom never fetches images, so drive load/error from the url itself.
class FakeImage {
  width = 10;
  height = 10;
  private listeners: Record<string, Listener[]> = {};

  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  set src(value: string) {
    if (!value) return;
    const outcome = value.includes('broken') ? 'error' : 'load';
    setTimeout(() => this.listeners[outcome]?.forEach((listener) => listener()), 0);
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
});
