export const isMarkdownShowAs = (options: unknown): boolean =>
  (options as { showAs?: { type?: string } } | undefined)?.showAs?.type === 'markdown';

export const normalizeMarkdownValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? '' : String(item)))
      .filter(Boolean)
      .join('\n');
  }
  if (value == null) return '';
  return String(value);
};
