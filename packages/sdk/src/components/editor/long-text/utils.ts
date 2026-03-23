import removeMd from 'remove-markdown';

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

export const stripMarkdown = (text: string): string => {
  return removeMd(text).replace(/\n+/g, ' ').trim();
};

/**
 * Normalize line breaks: convert hard breaks (`\` + newline) and `<br/>` to
 * plain newlines, then collapse 3+ consecutive newlines to at most `\n\n`.
 */
export const sanitizeMarkdownBreaks = (markdown: string): string =>
  markdown
    .replace(/\\\n/g, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n');
