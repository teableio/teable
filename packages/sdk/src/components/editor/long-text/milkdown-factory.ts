import {
  defaultValueCtx,
  Editor,
  editorViewOptionsCtx,
  prosePluginsCtx,
  rootCtx,
} from '@milkdown/core';
import { history } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import type { MutableRefObject } from 'react';
import { exitCodeBlockPlugin } from './milkdown-exit-code-plugin';
import { createLinkClickPlugin } from './milkdown-link-click-plugin';
import { noImagePastePlugin } from './milkdown-no-image-plugin';
import { createSelectionToolbarPlugin } from './milkdown-selection-toolbar-plugin';
import { createFloatingToolbarPlugin } from './milkdown-toolbar-plugin';

export interface IMilkdownEditorOptions {
  value: string;
  readonly?: boolean;
  /** Use fixed positioning for selection toolbar (needed in grid overlay) */
  useFixedSelectionToolbar?: boolean;
  /** Ref to receive latest markdown value on each update */
  latestValueRef?: MutableRefObject<string>;
  /** Callback to receive latest markdown value on each update */
  onMarkdownUpdated?: (markdown: string) => void;
}

/**
 * Shared factory for creating a milkdown editor instance.
 * Centralizes all milkdown initialization so swapping the editor only requires changing this file.
 */
export const createMilkdownEditor = (root: HTMLElement, options: IMilkdownEditorOptions) => {
  const { value, readonly, useFixedSelectionToolbar, latestValueRef, onMarkdownUpdated } = options;

  const editor = Editor.make().config((ctx) => {
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, value || '');

    if (readonly) {
      ctx.set(editorViewOptionsCtx, {
        editable: () => false,
        attributes: { class: 'milkdown-readonly' },
      });
    } else {
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        latestValueRef && (latestValueRef.current = markdown);
        onMarkdownUpdated?.(markdown);
      });
    }

    ctx.update(prosePluginsCtx, (plugins) => [
      ...plugins,
      exitCodeBlockPlugin,
      createLinkClickPlugin(!!readonly),
      ...(readonly
        ? []
        : [
            noImagePastePlugin,
            createFloatingToolbarPlugin(),
            createSelectionToolbarPlugin(
              useFixedSelectionToolbar ? { useFixedPosition: true } : undefined
            ),
          ]),
    ]);
  });

  editor.use(commonmark).use(gfm);
  if (!readonly) {
    editor.use(history).use(listener);
  }

  return editor;
};
