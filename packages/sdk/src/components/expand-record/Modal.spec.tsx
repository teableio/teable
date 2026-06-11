import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

// jsdom's getBoundingClientRect returns an all-zero DOMRect by default, which
// breaks the overlay's "click is inside DialogContent rect" check (a default
// fireEvent.click sends clientX/Y=0 and would be treated as inside the 0x0
// rect). Stub a realistic rect for all tests so the geometric check behaves
// like a real browser layout.
const CONTENT_RECT = {
  left: 100,
  right: 500,
  top: 100,
  bottom: 400,
  width: 400,
  height: 300,
  x: 100,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

describe('Modal (ExpandRecord wrapper)', () => {
  let originalGetRect: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    originalGetRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('role') === 'dialog') return CONTENT_RECT;
      return originalGetRect.call(this);
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetRect;
  });

  it('calls onClose when the overlay is clicked (T956)', () => {
    const onClose = vi.fn();
    render(
      <Modal visible onClose={onClose}>
        <div data-testid="content">inner</div>
      </Modal>
    );

    const overlay = document.querySelector<HTMLElement>('[data-state="open"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    // Click coordinate clearly outside DialogContent rect.
    fireEvent.click(overlay!, { clientX: 50, clientY: 50 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the dialog content', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <Modal visible onClose={onClose}>
        <div data-testid="content">inner</div>
      </Modal>
    );

    fireEvent.click(getByTestId('content'));

    expect(onClose).not.toHaveBeenCalled();
  });

  // Reproduces the bug where opening a nested modal Popover (e.g. SingleSelect)
  // makes a click inside DialogContent hit-test through to DialogOverlay. The
  // overlay click handler should detect that the pointer landed inside
  // DialogContent's bounding rect and skip onClose.
  it('ignores overlay click when pointer lands inside DialogContent rect', () => {
    const onClose = vi.fn();
    render(
      <Modal visible onClose={onClose}>
        <div data-testid="content">inner</div>
      </Modal>
    );

    const overlay = document.querySelector<HTMLElement>('[data-state="open"].fixed.inset-0');
    expect(overlay).not.toBeNull();

    // Click coordinate inside DialogContent rect (click-through case).
    fireEvent.click(overlay!, { clientX: 200, clientY: 200 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
