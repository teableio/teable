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

  it.each([false, true])('allows option list scrolling when isMultiple=%s', async (isMultiple) => {
    render(
      <Modal visible>
        <SelectEditor
          isMultiple={isMultiple}
          options={Array.from({ length: 20 }, (_, index) => ({
            value: `option-${index}`,
            label: `Option ${index}`,
          }))}
        />
      </Modal>
    );
    fireEvent.click(screen.getByRole('combobox'));
    const list = await screen.findByRole('listbox');

    // happy-dom has no layout; supply the scroll dimensions used by the dialog's scroll lock.
    list.style.overflowY = 'auto';
    Object.defineProperties(list, {
      clientHeight: { value: 272 },
      scrollHeight: { value: 640 },
    });
    list.scrollTop = 100;

    expect(fireEvent.wheel(list, { deltaY: 100 })).toBe(true);
    expect(fireEvent.wheel(list, { deltaY: -100 })).toBe(true);
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

  it.each([false, true])(
    'closes on Escape without closing the expand record when isMultiple=%s',
    async (isMultiple) => {
      const onClose = vi.fn();
      render(
        <Modal visible onClose={onClose}>
          <SelectEditor options={options} isMultiple={isMultiple} />
        </Modal>
      );
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      const input = await screen.findByPlaceholderText('common.search.placeholder');

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByPlaceholderText('common.search.placeholder')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  );
});
