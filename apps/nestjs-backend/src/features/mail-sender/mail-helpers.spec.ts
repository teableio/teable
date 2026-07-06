import { truncateMailName } from './mail-helpers';

describe('truncateMailName', () => {
  it('should truncate overlong names with an ellipsis', () => {
    expect(truncateMailName('a'.repeat(40), 32)).toBe(`${'a'.repeat(32)}…`);
  });

  it('should keep names within the limit unchanged', () => {
    expect(truncateMailName('John', 32)).toBe('John');
  });

  it('should disable truncation when the limit is 0 or NaN', () => {
    expect(truncateMailName('a'.repeat(40), 0)).toBe('a'.repeat(40));
    expect(truncateMailName('a'.repeat(40), NaN)).toBe('a'.repeat(40));
  });
});
