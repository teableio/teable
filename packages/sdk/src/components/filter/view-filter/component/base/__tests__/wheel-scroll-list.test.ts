import { describe, expect, it, vi } from 'vitest';
import { scrollListByWheel } from '../wheel-scroll-list';

describe('scrollListByWheel', () => {
  it('scrolls the list and stops propagation when content overflows', () => {
    const list = document.createElement('div');
    Object.defineProperty(list, 'clientHeight', { value: 272 });
    Object.defineProperty(list, 'scrollHeight', { value: 1200 });
    list.scrollTop = 0;

    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    scrollListByWheel(event, list);

    expect(list.scrollTop).toBe(120);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('does nothing when the list cannot scroll', () => {
    const list = document.createElement('div');
    Object.defineProperty(list, 'clientHeight', { value: 272 });
    Object.defineProperty(list, 'scrollHeight', { value: 272 });
    list.scrollTop = 0;

    const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    scrollListByWheel(event, list);

    expect(list.scrollTop).toBe(0);
  });
});
