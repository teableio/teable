import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../expand-record/Modal';
import { SelectEditor } from './Editor';

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

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

const options = [
  { value: 'todo', label: 'Todo' },
  { value: 'done', label: 'Done' },
];

describe('SelectEditor inside ExpandRecord Modal (T7102)', () => {
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

  const openSelect = async () => {
    render(
      <Modal visible>
        <SelectEditor options={options} />
      </Modal>
    );
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByPlaceholderText('common.search.placeholder')).toBeInTheDocument();
  };

  it('does not disable pointer events on the expand-record dialog while open', async () => {
    await openSelect();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.style.pointerEvents).not.toBe('none');
  });

  it('closes on outside pointerdown without closing the expand record', async () => {
    const onClose = vi.fn();
    render(
      <Modal visible onClose={onClose}>
        <SelectEditor options={options} />
      </Modal>
    );
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByPlaceholderText('common.search.placeholder')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByPlaceholderText('common.search.placeholder')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape without closing the expand record', async () => {
    const onClose = vi.fn();
    render(
      <Modal visible onClose={onClose}>
        <SelectEditor options={options} />
      </Modal>
    );
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByPlaceholderText('common.search.placeholder')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByPlaceholderText('common.search.placeholder')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
