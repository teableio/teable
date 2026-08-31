import { afterEach, describe, expect, it } from 'vitest';
import {
  detectTextDirection,
  isContentDirectionEnabled,
  isRtlLang,
  setContentDirectionEnabled,
} from './text-direction';

describe('isRtlLang', () => {
  it.each([
    ['ar', true],
    ['ar-EG', true],
    ['he', true],
    ['he-IL', true],
    ['en', false],
    ['zh', false],
    // Arabic script, but not a language the gate covers
    ['fa', false],
    [undefined, false],
  ])('resolves %s to %s', (lang, expected) => {
    expect(isRtlLang(lang)).toBe(expected);
  });
});

describe('detectTextDirection', () => {
  it.each([
    ['hello', 'ltr'],
    ['中文', 'ltr'],
    ['日本語', 'ltr'],
    ['مرحبا', 'rtl'],
    ['שלום', 'rtl'],
    ['ދިވެހި', 'rtl'],
  ])('reads the strong direction of %s', (text, expected) => {
    expect(detectTextDirection(text)).toBe(expected);
  });

  it('follows the first strong character, not the majority', () => {
    expect(detectTextDirection('iPhone مرحبا مرحبا مرحبا')).toBe('ltr');
    expect(detectTextDirection('مرحبا iPhone')).toBe('rtl');
  });

  it('skips leading neutrals', () => {
    expect(detectTextDirection('  "مرحبا"')).toBe('rtl');
    expect(detectTextDirection('(hello)')).toBe('ltr');
  });

  it.each(['', '123', '---', '2026-08-27'])(
    'returns null for %s, which carries no direction',
    (text) => {
      expect(detectTextDirection(text)).toBeNull();
    }
  );
});

describe('content direction gate', () => {
  afterEach(() => setContentDirectionEnabled(false));

  it('is off until switched on', () => {
    expect(isContentDirectionEnabled()).toBe(false);
    setContentDirectionEnabled(true);
    expect(isContentDirectionEnabled()).toBe(true);
  });
});
