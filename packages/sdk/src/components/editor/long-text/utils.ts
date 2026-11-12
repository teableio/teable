import type { Editor } from '@milkdown/core';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/core';
import type { Node as ProseNode } from '@milkdown/prose/model';
import removeMd from 'remove-markdown';

const escapedAutolinkRegExp = /\\<(https?\\?:\/\/[^>]+)>/g;

const normalizeEscapedAutolinkUrl = (url: string) => url.replaceAll('\\:', ':');

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

/**
 * `keepLines` keeps one item per line (grid cells wrap): list numbers stay,
 * bullets become `•`, and per-line indentation is dropped. Without it the
 * result is a single line for one-line previews.
 */
export const stripMarkdown = (text: string, options?: { keepLines?: boolean }): string => {
  // Preserve URLs from empty-label links [](url) and autolinks <url> before stripping
  const normalized = text
    .replace(/\\?<(\[[^\]]*\]\([^)]+\))>/g, '$1')
    .replace(escapedAutolinkRegExp, (_, url) => normalizeEscapedAutolinkUrl(url))
    .replace(/\[([^[\]]*)\]\(([^()]+)\)/g, (_, label, url) =>
      label.trim() ? `[${label}](${url})` : url
    )
    .replace(/<(https?:\/\/[^>]+)>/g, '$1');
  if (options?.keepLines) {
    return removeMd(normalized.replace(/^(\s*)[*+-]\s+/gm, '$1• '), {
      stripListLeaders: false,
      useImgAltText: true,
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }
  return removeMd(normalized).replace(/\n+/g, ' ').trim();
};

const parsesTo = (doc: ProseNode, parse: () => ProseNode): boolean => {
  try {
    return doc.eq(parse());
  } catch {
    return false;
  }
};

/**
 * Synchronously read current markdown from a milkdown editor instance,
 * bypassing the debounced listener. Returns `undefined` if the editor
 * is not ready.
 *
 * The serializer rewrites equivalent markdown (`-` bullets become `*`, blank
 * lines appear before lists, ...). Pass the text the editor was loaded with as
 * `original`: when the document still parses to the same content, that text is
 * returned as is, so merely focusing and leaving the editor saves nothing (T5237).
 */
export const getEditorMarkdown = (editor: Editor, original?: string): string | undefined => {
  try {
    return editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      if (original != null && parsesTo(doc, () => ctx.get(parserCtx)(original))) {
        return original;
      }
      return sanitizeMarkdownBreaks(ctx.get(serializerCtx)(doc));
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
    .replaceAll('\\\n', '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // Convert autolinks <url> to explicit [url](url) syntax
    .replace(/<(https?:\/\/[^>]+)>/g, '[$1]($1)');
