import enSdk from '@teable/common-i18n/src/locales/en/sdk.json';
import { sonner } from '@teable/ui-lib';
import { fireEvent, render as renderComponent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../../context/app/AppContext';
import { Modal } from '../../expand-record/Modal';
import { SelectEditor } from './Editor';

const render = (ui: ReactNode) =>
  renderComponent(
    <AppContext.Provider value={{ locale: enSdk, lang: 'en' }}>{ui}</AppContext.Provider>
  );

const searchPlaceholder = enSdk.common.search.placeholder;

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
    expect(await screen.findByPlaceholderText(searchPlaceholder)).toBeInTheDocument();
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
    expect(await screen.findByPlaceholderText(searchPlaceholder)).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByPlaceholderText(searchPlaceholder)).not.toBeInTheDocument();
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
      const input = await screen.findByPlaceholderText(searchPlaceholder);

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByPlaceholderText(searchPlaceholder)).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  );
});

describe('SelectEditor search field focus by pointer kind', () => {
  const originalMatchMedia = window.matchMedia;

  const stubPrimaryPointer = (coarse: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: coarse && query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  };

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const openList = async () => {
    render(
      <Modal visible>
        <SelectEditor options={options} />
      </Modal>
    );
    fireEvent.click(screen.getByRole('combobox'));
    return screen.findByPlaceholderText(searchPlaceholder);
  };

  // The environment has no layout, so which element inside the list ends up focused is
  // its business; what matters is whether focus moves into the list at all.
  const listOf = (input: HTMLElement) => input.closest<HTMLElement>('[data-state="open"]');

  it('moves focus into the list under a pointer', async () => {
    stubPrimaryPointer(false);
    const input = await openList();
    expect(listOf(input)?.contains(document.activeElement)).toBe(true);
  });

  it('leaves focus where it was under a finger, so no keyboard covers the list', async () => {
    stubPrimaryPointer(true);
    const input = await openList();
    expect(listOf(input)?.contains(document.activeElement)).toBe(false);
  });
});

describe('SelectEditor option creation feedback (T4291)', () => {
  const { Toaster, toast } = sonner;

  // The handler keeps one toast per title + description for a few seconds and the
  // sonner store outlives a single render, so each case reports its own server
  // message instead of relying on ordering between tests.
  const OVERLONG_CHOICE = 'x'.repeat(1001);

  beforeEach(() => {
    toast.dismiss();
  });

  const openEditor = async (onOptionAdd: (name: string) => Promise<void>, isMultiple = false) => {
    const onChange = vi.fn();
    render(
      <>
        <SelectEditor
          options={options}
          isMultiple={isMultiple}
          onChange={onChange}
          onOptionAdd={onOptionAdd}
        />
        <Toaster />
      </>
    );
    fireEvent.click(screen.getByRole('combobox'));
    const input = await screen.findByPlaceholderText(searchPlaceholder);
    return { input, onChange };
  };

  // Enter on a name matching no choice is the same path as clicking the add row:
  // SelectEditorMain.onOptionAddInner.
  const submitNewOption = (input: HTMLElement, name: string) => {
    fireEvent.change(input, { target: { value: name } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('localizes a rejected overlong choice without exposing diagnostic details', async () => {
    const diagnosticMessage = `Internal server error: SQL rejected ${OVERLONG_CHOICE}`;
    const onOptionAdd = vi.fn().mockRejectedValue({
      status: 400,
      code: 'validation_error',
      message: diagnosticMessage,
      data: {
        localization: {
          i18nKey: 'httpErrors.limit.selectChoiceNameMaxLength',
          context: { max: 1000 },
        },
      },
    });
    const { input, onChange } = await openEditor(onOptionAdd);

    submitNewOption(input, OVERLONG_CHOICE);

    const localizedMessage = await screen.findByText(/1000/);
    const toastContent = localizedMessage.closest('[data-sonner-toast]')?.textContent ?? '';
    expect(toastContent).toContain('1000');
    expect(toastContent).not.toContain('httpErrors.');
    expect(toastContent).not.toContain('{{max}}');
    expect(toastContent).not.toContain('Internal server error');
    expect(toastContent).not.toContain('SQL');
    expect(toastContent).not.toContain(OVERLONG_CHOICE);
    expect(onOptionAdd).toHaveBeenCalledTimes(1);
    expect(onOptionAdd).toHaveBeenCalledWith(OVERLONG_CHOICE);
    expect(input).toHaveValue(OVERLONG_CHOICE);
    expect(onChange).not.toHaveBeenCalled();
    // Single select: no value was committed, so the list stays open.
    expect(screen.getByPlaceholderText(searchPlaceholder)).toBeInTheDocument();
  });

  it('clears the input and commits once when the retry succeeds', async () => {
    const message = 'Choice limit reached: retry';
    const onOptionAdd = vi
      .fn()
      .mockRejectedValueOnce({ status: 400, code: 'validation_error', message })
      .mockResolvedValueOnce(undefined);
    const { input, onChange } = await openEditor(onOptionAdd, true);

    submitNewOption(input, 'Retry me');
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input).toHaveValue(''));
    expect(onOptionAdd).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['Retry me']);
  });

  it('preserves a newer search while the previous choice is being created', async () => {
    const firstCreate = Promise.withResolvers<void>();
    const onOptionAdd = vi
      .fn()
      .mockImplementationOnce(() => firstCreate.promise)
      .mockResolvedValueOnce(undefined);
    const { input, onChange } = await openEditor(onOptionAdd, true);

    submitNewOption(input, 'A');
    fireEvent.change(input, { target: { value: 'B' } });
    firstCreate.resolve();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('B');
    expect(onOptionAdd).toHaveBeenCalledTimes(1);
    expect(onOptionAdd).toHaveBeenNthCalledWith(1, 'A');
    expect(onChange).toHaveBeenNthCalledWith(1, ['A']);

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input).toHaveValue(''));
    expect(onOptionAdd).toHaveBeenCalledTimes(2);
    expect(onOptionAdd).toHaveBeenNthCalledWith(2, 'B');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(2, ['A', 'B']);
  });

  it('sends a single create while one is still in flight', async () => {
    const deferred = Promise.withResolvers<void>();
    const onOptionAdd = vi.fn(() => deferred.promise);
    const { input, onChange } = await openEditor(onOptionAdd, true);

    fireEvent.change(input, { target: { value: 'Double enter' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onOptionAdd).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await waitFor(() => expect(input).toHaveValue(''));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['Double enter']);
  });
});
