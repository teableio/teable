import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal (ExpandRecord wrapper)', () => {
  it('calls onClose when the overlay is clicked (T956)', () => {
    const onClose = vi.fn();
    render(
      <Modal visible onClose={onClose}>
        <div data-testid="content">inner</div>
      </Modal>
    );

    const overlay = document.querySelector<HTMLElement>('[data-state="open"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);

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
});
