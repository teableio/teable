import { parserCtx, schemaCtx } from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import { getNodeFromSchema, isTextOnlySlice } from '@milkdown/prose';
import { DOMParser, DOMSerializer } from '@milkdown/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';

const VSCODE_TEXT_MODES = new Set(['markdown', 'plaintext', 'plain']);

/**
 * Create a ProseMirror plugin that handles all paste events:
 * - VSCode code pastes (JS, Python, etc.) → code block with language
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

        // Parse text/plain as markdown
        const parser = ctx.get(parserCtx);
        const parsed = parser(text);
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
      },
    },
  });
