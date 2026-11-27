import { describe, expect, it, vi } from 'vitest';
import { consumeFilePaste } from './useDragFile';

describe('consumeFilePaste', () => {
  it('stops a handled file paste and forwards all files once', () => {
    const event = { stopPropagation: vi.fn() } as unknown as Event;
    const files = [new File(['one'], 'one.png'), new File(['two'], 'two.png')];
    const onChange = vi.fn();
    consumeFilePaste(event, files, onChange);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(files);
  });

  it('does not consume an empty paste', () => {
    const event = { stopPropagation: vi.fn() } as unknown as Event;
    const onChange = vi.fn();
    consumeFilePaste(event, [], onChange);
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
