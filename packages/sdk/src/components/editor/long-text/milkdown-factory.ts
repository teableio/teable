import {
  defaultValueCtx,
  Editor,
  editorViewOptionsCtx,
  prosePluginsCtx,
  rootCtx,
} from '@milkdown/core';
import { clipboard } from '@milkdown/plugin-clipboard';
import { history } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { commonmark, linkSchema } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import type { MutableRefObject } from 'react';
import { exitCodeBlockPlugin } from './milkdown-exit-code-plugin';
import { createLinkClickPlugin } from './milkdown-link-click-plugin';
import { createMarkdownPastePlugin } from './milkdown-markdown-paste-plugin';
import { noImagePastePlugin } from './milkdown-no-image-plugin';
import { createSelectionToolbarPlugin } from './milkdown-selection-toolbar-plugin';
import { createFloatingToolbarPlugin } from './milkdown-toolbar-plugin';
import { sanitizeMarkdownBreaks } from './utils';

/**
 * Override the link mark schema to set `inclusive: false`.
 * This prevents text typed at link boundaries from being absorbed into the link.
 */
const nonInclusiveLinkSchema = linkSchema.extendSchema((prev) => (ctx) => ({
  ...prev(ctx),
  inclusive: false,
}));

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
      ctx
        .get(listenerCtx)
        .markdownUpdated((_ctx, markdown) => {
          const clean = sanitizeMarkdownBreaks(markdown);
          latestValueRef && (latestValueRef.current = clean);
          onMarkdownUpdated?.(clean);
        })
        .destroy((_ctx) => {
          // Clear listeners so that the debounced markdownUpdated handler
          // (200ms delay inside the listener plugin) becomes a no-op after
          // the editor view is destroyed, preventing "Context editorView not found".
          const mgr = _ctx.get(listenerCtx).listeners;
          mgr.markdownUpdated.length = 0;
          mgr.updated.length = 0;
        });
    }

    ctx.update(prosePluginsCtx, (plugins) => [
      ...plugins,
      exitCodeBlockPlugin,
      createLinkClickPlugin(!!readonly),
      ...(readonly
        ? []
        : [
            createMarkdownPastePlugin(ctx),
            noImagePastePlugin,
            createFloatingToolbarPlugin(),
            createSelectionToolbarPlugin(
              useFixedSelectionToolbar ? { useFixedPosition: true } : undefined
            ),
          ]),
    ]);
  });

  editor.use(commonmark).use(gfm).use(nonInclusiveLinkSchema);
  if (!readonly) {
    editor.use(clipboard).use(history).use(listener);
  }

  return editor;
};
