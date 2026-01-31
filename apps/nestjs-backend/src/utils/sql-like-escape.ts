/**
 * Escape SQL LIKE wildcards (%, _, \) for use with ESCAPE '\' clause
 */
export function escapeLikeWildcards(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(/[\\%_]/g, '\\$&');
}
