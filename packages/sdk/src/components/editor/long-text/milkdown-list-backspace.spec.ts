import { editorViewCtx } from '@milkdown/core';
import { TextSelection } from '@milkdown/prose/state';
import { describe, expect, it } from 'vitest';
import { createMilkdownEditor } from './milkdown-factory';
import { getEditorMarkdown } from './utils';

const createEditor = async (value: string) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return createMilkdownEditor(root, { value }).create();
};

/**
 * Puts the cursor at the start of `text` and presses Backspace. `handled` is false when no
 * ProseMirror keymap takes the key, so the browser's native contenteditable deletion runs
 * and ProseMirror re-parses the mangled DOM afterwards.
 */
const pressBackspaceAtStartOf = async (markdown: string, text: string) => {
  const editor = await createEditor(markdown);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    let pos = -1;
    view.state.doc.descendants((node, p) => {
      if (pos < 0 && node.isText && node.text?.startsWith(text)) pos = p;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    const event = new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8 });
    const handled = !!view.someProp('handleKeyDown', (f) => f(view, event));
    return { handled, markdown: getEditorMarkdown(editor) };
  });
};

describe('markdown editor: Backspace at the start of the first ordered list item (T4877)', () => {
  it('handles Backspace on a first item without a nested list', async () => {
    const result = await pressBackspaceAtStartOf('1. 需求\n2. 工具提及\n', '需求');
    expect(result).toEqual({ handled: true, markdown: '需求\n\n1. 工具提及\n' });
  });

  it('handles Backspace on a first item that owns a nested list', async () => {
    const result = await pressBackspaceAtStartOf(
      '1. 需求\n   1. api connection\n   2. better than zapier\n2. 工具提及\n',
      '需求'
    );
    // Lifted out like Shift-Tab: the text becomes a paragraph and its nested items a list of
    // their own — no empty numbered item is left holding them.
    expect(result).toEqual({
      handled: true,
      markdown: '需求\n\n1. api connection\n2. better than zapier\n\n1) 工具提及\n',
    });
  });
});
