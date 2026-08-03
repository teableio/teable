import type { Editor } from '@milkdown/core';
import { editorViewCtx, serializerCtx } from '@milkdown/core';
import removeMd from 'remove-markdown';

const escapedAutolinkRegExp = /\\<(https?\\?:\/\/[^>]+)>/g;

const normalizeEscapedAutolinkUrl = (url: string) => url.replace(/\\:/g, ':');

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
  // Preserve URLs from empty-label links [](url) and autolinks <url> before stripping
  const normalized = text
    .replace(/\\?<(\[[^\]]*\]\([^)]+\))>/g, '$1')
    .replace(escapedAutolinkRegExp, (_, url) => normalizeEscapedAutolinkUrl(url))
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label, url) =>
      label.trim() ? `[${label}](${url})` : url
    )
    .replace(/<(https?:\/\/[^>]+)>/g, '$1');
  return removeMd(normalized).replace(/\n+/g, ' ').trim();
};

/**
 * Synchronously read current markdown from a milkdown editor instance,
 * bypassing the debounced listener. Returns `undefined` if the editor
 * is not ready.
 */
export const getEditorMarkdown = (editor: Editor): string | undefined => {
  try {
    return editor.action((ctx) => {
      const serializer = ctx.get(serializerCtx);
      const view = ctx.get(editorViewCtx);
      return sanitizeMarkdownBreaks(serializer(view.state.doc));
    });
  } catch {
    return undefined;
  }
};

/**
 * Normalize line breaks: convert hard breaks (`\` + newline) and `<br/>` to
 * plain newlines, then collapse 3+ consecutive newlines to at most `\n\n`.
 */
export const sanitizeMarkdownBreaks = (markdown: string): string =>
  markdown
    .replace(/\\\n/g, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // Convert autolinks <url> to explicit [url](url) syntax
    .replace(/<(https?:\/\/[^>]+)>/g, '[$1]($1)');
