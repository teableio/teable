import { describe, expect, it } from 'vitest';
import { shouldForwardPasteToGrid } from './paste';

describe('shouldForwardPasteToGrid', () => {
  it('forwards paste when the cell is selected but not editing', () => {
    expect(
      shouldForwardPasteToGrid({
        isEditing: false,
        eventTarget: document.createElement('div'),
        hiddenFocusEl: document.createElement('input'),
      })
    ).toBe(true);
  });

  it('forwards paste from the hidden focus input while a picker is open (T3702)', () => {
    const hiddenFocusEl = document.createElement('input');
    hiddenFocusEl.className = 'size-0 opacity-0';

    expect(
      shouldForwardPasteToGrid({
        isEditing: true,
        eventTarget: hiddenFocusEl,
        hiddenFocusEl,
      })
    ).toBe(true);
  });

  it('forwards paste from the picker container when search is not focused (T3702)', () => {
    expect(
      shouldForwardPasteToGrid({
        isEditing: true,
        eventTarget: document.createElement('div'),
        hiddenFocusEl: document.createElement('input'),
      })
    ).toBe(true);
  });

  it('keeps native paste inside a visible search or text input', () => {
    const searchInput = document.createElement('input');
    const hiddenFocusEl = document.createElement('input');

    expect(
      shouldForwardPasteToGrid({
        isEditing: true,
        eventTarget: searchInput,
        hiddenFocusEl,
      })
    ).toBe(false);
  });

  it('keeps native paste inside a textarea or contenteditable editor', () => {
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    const hiddenFocusEl = document.createElement('input');

    expect(
      shouldForwardPasteToGrid({
        isEditing: true,
        eventTarget: textarea,
        hiddenFocusEl,
      })
    ).toBe(false);
    expect(
      shouldForwardPasteToGrid({
        isEditing: true,
        eventTarget: editable,
        hiddenFocusEl,
      })
    ).toBe(false);
  });
});
