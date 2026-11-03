import { editorViewCtx } from '@milkdown/core';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { MarkdownReadonly } from '@teable/ui-lib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMilkdownEditor } from './milkdown-factory';
import { getEditorMarkdown } from './utils';

const createEditor = async (value: string) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return createMilkdownEditor(root, { value }).create();
};

const boldTexts = (doc: ProseNode) => {
  const result: string[] = [];
  doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === 'strong')) {
      result.push(node.text ?? '');
    }
  });
  return result;
};

describe('milkdown bold round-trip (T6801)', () => {
  it.each([
    ['full-width colon followed by CJK', '新增共享 Skills 管理能力：', '创建 Skill 后'],
    ['full-width paren followed by CJK', '能力（新）', '创建'],
  ])('keeps bold after serialize + reparse: %s', async (_name, boldPart, rest) => {
    const editor = await createEditor(`- ${boldPart}${rest}`);

    // Simulate selecting the leading text and pressing the Bold button.
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let from = -1;
      view.state.doc.descendants((node, pos) => {
        if (from < 0 && node.isText) from = pos;
      });
      const strong = view.state.schema.marks.strong!;
      view.dispatch(view.state.tr.addMark(from, from + boldPart.length, strong.create()));
      expect(boldTexts(view.state.doc)).toEqual([boldPart]);
    });

    const markdown = getEditorMarkdown(editor)!;
    // Value saved to the cell is reloaded into a fresh editor (what the user sees after save).
    const reloaded = await createEditor(markdown);
    const doc = reloaded.action((ctx) => ctx.get(editorViewCtx).state.doc);

    expect({ markdown, bold: boldTexts(doc) }).toEqual({ markdown, bold: [boldPart] });
  });

  it('renders bold closed by CJK punctuation in the readonly view', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownReadonly, { value: '- **新增共享 Skills 管理能力：**创建 Skill 后' })
    );
    expect(html).toContain('<strong>新增共享 Skills 管理能力：</strong>创建 Skill 后');
  });
});
