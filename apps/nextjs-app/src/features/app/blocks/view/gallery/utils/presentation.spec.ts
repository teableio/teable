import { describe, expect, it } from 'vitest';
import {
  clampIndex,
  getRecordWindow,
  resolvePresentationKey,
  shouldIgnorePresentationHotkey,
  stepIndex,
} from './presentation';

describe('clampIndex', () => {
  it('returns 0 when the set is empty', () => {
    expect(clampIndex(3, 0)).toBe(0);
    expect(clampIndex(-1, 0)).toBe(0);
  });

  it('clamps to the last record in the filtered set', () => {
    expect(clampIndex(9, 4)).toBe(3);
  });

  it('clamps negative indexes to 0', () => {
    expect(clampIndex(-2, 4)).toBe(0);
  });

  it('keeps an in-range index', () => {
    expect(clampIndex(2, 4)).toBe(2);
  });
});

describe('stepIndex', () => {
  it('moves forward and backward inside the current filtered set', () => {
    expect(stepIndex(1, 5, 1)).toBe(2);
    expect(stepIndex(1, 5, -1)).toBe(0);
  });

  it('does not wrap at either end', () => {
    expect(stepIndex(0, 5, -1)).toBe(0);
    expect(stepIndex(4, 5, 1)).toBe(4);
  });
});

describe('getRecordWindow', () => {
  it('loads the first three records when presenting the first slide', () => {
    expect(getRecordWindow(0)).toEqual({ skip: 0, take: 3, offset: 0 });
  });

  it('centers the window on the current slide so prev and next stay available', () => {
    expect(getRecordWindow(4)).toEqual({ skip: 3, take: 3, offset: 1 });
  });
});

describe('resolvePresentationKey', () => {
  it('maps arrow and vim keys to next and previous', () => {
    expect(resolvePresentationKey({ key: 'ArrowRight' })).toBe('next');
    expect(resolvePresentationKey({ key: 'j' })).toBe('next');
    expect(resolvePresentationKey({ key: 'J' })).toBe('next');
    expect(resolvePresentationKey({ key: 'ArrowLeft' })).toBe('prev');
    expect(resolvePresentationKey({ key: 'k' })).toBe('prev');
    expect(resolvePresentationKey({ key: 'K' })).toBe('prev');
  });

  it('maps Escape to exit', () => {
    expect(resolvePresentationKey({ key: 'Escape' })).toBe('exit');
  });

  it('ignores unrelated keys', () => {
    expect(resolvePresentationKey({ key: 'Enter' })).toBeNull();
    expect(resolvePresentationKey({ key: ' ' })).toBeNull();
  });
});

describe('shouldIgnorePresentationHotkey', () => {
  it('ignores typing in form fields and contenteditable', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';

    expect(shouldIgnorePresentationHotkey(input)).toBe(true);
    expect(shouldIgnorePresentationHotkey(textarea)).toBe(true);
    expect(shouldIgnorePresentationHotkey(select)).toBe(true);
    expect(shouldIgnorePresentationHotkey(editable)).toBe(true);
  });

  it('handles keys from the slide chrome', () => {
    const button = document.createElement('button');
    expect(shouldIgnorePresentationHotkey(button)).toBe(false);
    expect(shouldIgnorePresentationHotkey(null)).toBe(false);
  });
});
