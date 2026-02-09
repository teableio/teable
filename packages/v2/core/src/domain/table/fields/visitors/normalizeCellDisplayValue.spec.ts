import { describe, expect, it } from 'vitest';

import { normalizeCellDisplayValue, normalizeCellDisplayValues } from './normalizeCellDisplayValue';

describe('normalizeCellDisplayValue', () => {
  it.each([
    ['user item', { id: 'usr1', title: 'Alice', email: 'alice@example.com' }, 'Alice'],
    ['createdBy item', { id: 'usr2', title: 'Bob' }, 'Bob'],
    ['link item', { id: 'rec1', title: 'Task 1' }, 'Task 1'],
    ['json with name', { name: 'Json Name', foo: 'bar' }, 'Json Name'],
    ['json without label', { foo: 'bar' }, '{"foo":"bar"}'],
    ['string', 'Text', 'Text'],
    ['number', 123, '123'],
  ])('normalizes %s', (_, input, expected) => {
    expect(normalizeCellDisplayValue(input)).toBe(expected);
  });

  it('normalizes arrays for multi-select', () => {
    const values = normalizeCellDisplayValues([{ title: 'A' }, { name: 'B' }, { foo: 'bar' }, 'C']);
    expect(values).toEqual(['A', 'B', '{"foo":"bar"}', 'C']);
  });
});
