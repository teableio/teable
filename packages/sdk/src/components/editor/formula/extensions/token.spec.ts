import { describe, expect, it } from 'vitest';
import { FORMULA_VARIABLE_REG } from './token';

const matchVariable = (text: string) => text.match(FORMULA_VARIABLE_REG)?.[0] ?? null;

describe('FORMULA_VARIABLE_REG', () => {
  it('matches a field reference at the start of the stream', () => {
    expect(matchVariable('{}')).toBe('{}');
    expect(matchVariable('{Name} & {Age}')).toBe('{Name}');
    expect(matchVariable('{fld1234567890abcd}')).toBe('{fld1234567890abcd}');
  });

  it('does not close on a backslash-escaped brace', () => {
    expect(matchVariable('{a\\}b} + 1')).toBe('{a\\}b}');
    expect(matchVariable('{\\}}')).toBe('{\\}}');
    expect(matchVariable('{a\\\\}')).toBeNull();
  });

  it('only matches at the current position', () => {
    expect(matchVariable('1 + {Name}')).toBeNull();
    expect(matchVariable('{unterminated')).toBeNull();
  });

  it('stays linear on long unterminated input', () => {
    const text = `{${'\\{'.repeat(50_000)}`;
    const start = performance.now();
    expect(matchVariable(text)).toBeNull();
    expect(performance.now() - start).toBeLessThan(500);
  });
});
