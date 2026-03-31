import { parserCtx, schemaCtx } from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import { getNodeFromSchema, isTextOnlySlice } from '@milkdown/prose';
import { DOMParser, DOMSerializer } from '@milkdown/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import TurndownService from 'turndown';

const VSCODE_TEXT_MODES = new Set(['markdown', 'plaintext', 'plain']);

const isGoogleDocsHtml = (html: string) => html.includes('docs-internal-guid');

let _turndown: TurndownService | null = null;
const getTurndown = () => {
  if (!_turndown) {
    _turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
  }
  return _turndown;
};

/**
 * Parse markdown text into a ProseMirror slice and dispatch it.
 * Returns true if the paste was handled.
 */
const pasteMarkdown = (
  ctx: Ctx,
  view: Parameters<NonNullable<NonNullable<Plugin['props']>['handlePaste']>>[0],
  markdown: string
): boolean => {
  const schema = ctx.get(schemaCtx);
  const parser = ctx.get(parserCtx);
  const parsed = parser(markdown);
  if (!parsed) return false;

  const dom = DOMSerializer.fromSchema(schema).serializeFragment(parsed.content);
  const slice = DOMParser.fromSchema(schema).parseSlice(dom);

  const node = isTextOnlySlice(slice);
  if (node) {
    view.dispatch(view.state.tr.replaceSelectionWith(node, true));
    return true;
  }

  try {
    view.dispatch(view.state.tr.replaceSelection(slice));
    return true;
  } catch {
    return false;
  }
};

/**
 * Create a ProseMirror plugin that handles all paste events:
 * - VSCode code pastes (JS, Python, etc.) → code block with language
 * - Google Docs HTML → convert to markdown via turndown, then parse
 * - Everything else → parse text/plain as markdown
 *
 * This replaces the clipboard plugin's handlePaste entirely.
 */
export const createMarkdownPastePlugin = (ctx: Ctx) =>
  new Plugin({
    key: new PluginKey('MILKDOWN_MARKDOWN_PASTE'),
    props: {
      handlePaste: (view, event) => {
        const editable = view.props.editable?.(view.state);
        const { clipboardData } = event;
        if (!editable || !clipboardData) return false;

        const text = clipboardData.getData('text/plain');
        if (!text) return false;

        // Don't interfere when pasting inside a code block
        const currentNode = view.state.selection.$from.node();
        if (currentNode.type.spec.code) return false;

        const schema = ctx.get(schemaCtx);

        // VSCode paste: create code block for code languages, parse markdown for text
        const vscodeData = clipboardData.getData('vscode-editor-data');
        if (vscodeData) {
          try {
            const data = JSON.parse(vscodeData);
            const mode = data?.mode?.toLowerCase();
            if (mode && !VSCODE_TEXT_MODES.has(mode)) {
              // Code language → create code block
              const { tr } = view.state;
              const codeBlock = getNodeFromSchema('code_block', schema);
              tr.replaceSelectionWith(codeBlock.create({ language: mode }))
                .setSelection(
                  TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2)))
                )
                .insertText(text.replace(/\r\n?/g, '\n'));
              view.dispatch(tr);
              return true;
            }
          } catch {
            // ignore parse error, fall through to markdown parsing
          }
        }

        // Google Docs paste: convert HTML to markdown via turndown
        const html = clipboardData.getData('text/html');
        if (html && isGoogleDocsHtml(html)) {
          const markdown = getTurndown()
            .turndown(html)
            // Clean up empty bold/italic markers left by Google Docs' <b>/<i> wrappers
            .replace(/^[*_]{2,}\s*$/gm, '')
            .replace(/^\s*\n/, '')
            .replace(/\n\s*$/, '');
          return pasteMarkdown(ctx, view, markdown);
        }

        // Default: parse text/plain as markdown
        return pasteMarkdown(ctx, view, text);
      },
    },
  });
