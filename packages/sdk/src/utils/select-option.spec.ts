import type { ISelectFieldOptions } from '@teable/core';
import { Colors } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { ensureSelectChoice } from './select-option';

describe('ensureSelectChoice T6007', () => {
  it('appends a missing choice so local options include the new name', () => {
    const options: ISelectFieldOptions = {
      choices: [{ id: 'choOpen001', name: 'Open', color: Colors.BlueBright }],
    };

    const choice = ensureSelectChoice(options, 'Closed');

    expect(choice?.name).toBe('Closed');
    expect(choice?.id).toMatch(/^cho/);
    expect(options.choices).toHaveLength(2);
    expect(options.choices.some((item) => item.name === 'Closed')).toBe(true);
  });

  it('returns the existing choice without duplicating names', () => {
    const options: ISelectFieldOptions = {
      choices: [{ id: 'choOpen001', name: 'Open', color: Colors.BlueBright }],
    };

    const first = ensureSelectChoice(options, 'Open');
    const second = ensureSelectChoice(options, 'Open');

    expect(first).toBe(options.choices[0]);
    expect(second).toBe(options.choices[0]);
    expect(options.choices).toHaveLength(1);
  });

  it('trims the option name before matching or inserting', () => {
    const options: ISelectFieldOptions = {
      choices: [],
    };

    const choice = ensureSelectChoice(options, '  Review  ');

    expect(choice?.name).toBe('Review');
    expect(options.choices).toEqual([
      expect.objectContaining({
        name: 'Review',
      }),
    ]);
  });

  it('is a no-op for empty names or missing options', () => {
    expect(ensureSelectChoice(undefined, 'Open')).toBeUndefined();
    expect(ensureSelectChoice({ choices: [] }, '   ')).toBeUndefined();
  });
});
