import { editorViewCtx } from '@milkdown/core';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownLongTextEditor } from './MarkdownEditor';
import { createMilkdownEditor } from './milkdown-factory';
import { getEditorMarkdown } from './utils';

// Hand-written markdown the serializer would rewrite: `-` bullets, no blank line before lists.
const VALUE =
  '文本字段在 Markdown 展示下。\n\n现象：\n- 字段移动后\n- 按钮残留\n\n期望：\n- 不应残留';

const createEditor = async (value: string) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return createMilkdownEditor(root, { value }).create();
};

const flushEditor = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

describe('markdown long text keeps untouched values (T5237)', () => {
  it('returns the original text while the document is unchanged', async () => {
    const editor = await createEditor(VALUE);

    expect(getEditorMarkdown(editor, VALUE)).toBe(VALUE);
  });

  it('serializes the document once it has been edited', async () => {
    const editor = await createEditor(VALUE);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText('新增', 1));
    });

    const markdown = getEditorMarkdown(editor, VALUE);
    expect(markdown).not.toBe(VALUE);
    expect(markdown).toContain('新增文本字段');
  });

  it('does not call onChange when focused and blurred without edits', async () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownLongTextEditor value={VALUE} onChange={onChange} />);
    await flushEditor();

    const editable = container.querySelector('.ProseMirror') as HTMLElement;
    fireEvent.focus(editable);
    fireEvent.blur(editable);

    expect(onChange).not.toHaveBeenCalled();
  });
});
