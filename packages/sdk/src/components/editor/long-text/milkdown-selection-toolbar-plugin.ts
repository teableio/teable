import { toggleMark } from '@milkdown/prose/commands';
import type { MarkType, Schema } from '@milkdown/prose/model';
import { Plugin, PluginKey, type EditorState } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { Bold, Code, Italic, Link, Strikethrough, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

interface InlineToolbarItem {
  id: string;
  icon: string;
  title: string;
  action: (view: EditorView) => void;
  isActive: (state: EditorState) => boolean;
}

function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    return !!type.isInSet(state.storedMarks || $from.marks());
  }
  return state.doc.rangeHasMark(from, to, type);
}

const INLINE_ICONS: Record<string, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  code: Code,
  link: Link,
};

function createSvgIcon(id: string): string {
  const Icon = INLINE_ICONS[id];
  if (!Icon) return '';
  return renderToStaticMarkup(createElement(Icon, { size: 16, strokeWidth: 1.75 }));
}

function buildInlineItems(schema: Schema): InlineToolbarItem[] {
  const items: InlineToolbarItem[] = [];

  if (schema.marks.strong) {
    items.push({
      id: 'bold',
      icon: createSvgIcon('bold'),
      title: 'Bold',
      action: (view) => {
        toggleMark(schema.marks.strong!)(view.state, view.dispatch.bind(view));
        view.focus();
      },
      isActive: (state) => isMarkActive(state, schema.marks.strong!),
    });
  }

  if (schema.marks.emphasis) {
    items.push({
      id: 'italic',
      icon: createSvgIcon('italic'),
      title: 'Italic',
      action: (view) => {
        toggleMark(schema.marks.emphasis!)(view.state, view.dispatch.bind(view));
        view.focus();
      },
      isActive: (state) => isMarkActive(state, schema.marks.emphasis!),
    });
  }

  if (schema.marks.strike_through) {
    items.push({
      id: 'strikethrough',
      icon: createSvgIcon('strikethrough'),
      title: 'Strikethrough',
      action: (view) => {
        toggleMark(schema.marks.strike_through!)(view.state, view.dispatch.bind(view));
        view.focus();
      },
      isActive: (state) => isMarkActive(state, schema.marks.strike_through!),
    });
  }

  if (schema.marks.inlineCode) {
    items.push({
      id: 'code',
      icon: createSvgIcon('code'),
      title: 'Code',
      action: (view) => {
        toggleMark(schema.marks.inlineCode!)(view.state, view.dispatch.bind(view));
        view.focus();
      },
      isActive: (state) => isMarkActive(state, schema.marks.inlineCode!),
    });
  }

  if (schema.marks.link) {
    items.push({
      id: 'link',
      icon: createSvgIcon('link'),
      title: 'Link',
      action: (view) => {
        const { state } = view;
        const linkMark = schema.marks.link!;
        if (isMarkActive(state, linkMark)) {
          toggleMark(linkMark)(state, view.dispatch.bind(view));
          view.focus();
        }
        // Link creation is handled by enterLinkMode in the plugin
      },
      isActive: (state) => isMarkActive(state, schema.marks.link!),
    });
  }

  return items;
}

export const selectionToolbarPluginKey = new PluginKey('milkdown-selection-toolbar');

export interface SelectionToolbarOptions {
  useFixedPosition?: boolean;
}

export function createSelectionToolbarPlugin(options?: SelectionToolbarOptions): Plugin {
  const useFixed = options?.useFixedPosition ?? true;
  let tooltip: HTMLDivElement | null = null;
  let containerEl: HTMLElement | null = null;
  let buttonsWrap: HTMLDivElement | null = null;
  let linkWrap: HTMLDivElement | null = null;
  let linkInput: HTMLInputElement | null = null;
  let items: InlineToolbarItem[] = [];
  let buttons: HTMLButtonElement[] = [];
  let removeDocMouseDownListener: (() => void) | null = null;
  let removeWindowListeners: (() => void) | null = null;
  let savedSelection: { from: number; to: number } | null = null;
  let linkMode = false;

  function enterLinkMode(view: EditorView) {
    if (!buttonsWrap || !linkWrap || !linkInput) return;

    const { state } = view;
    const { from, to } = state.selection;
    savedSelection = { from, to };

    const text = state.doc.textBetween(from, to);
    const href = /^https?:\/\//.test(text) ? text : '';

    const linkMark = state.schema.marks.link;
    if (linkMark) {
      const marks = state.selection.$from.marks();
      const existingLink = marks.find((m) => m.type === linkMark);
      linkInput.value = existingLink?.attrs.href ? (existingLink.attrs.href as string) : href;
    }

    linkMode = true;
    buttonsWrap.style.display = 'none';
    linkWrap.style.display = 'flex';

    // Reposition now that the width changed
    updateTooltipPosition(view);

    requestAnimationFrame(() => {
      linkInput?.focus();
      linkInput?.select();
    });
  }

  function exitLinkMode(view?: EditorView) {
    if (!buttonsWrap || !linkWrap) return;
    linkMode = false;
    linkWrap.style.display = 'none';
    buttonsWrap.style.display = 'flex';
    savedSelection = null;
    if (linkInput) linkInput.value = '';
    view?.focus();
  }

  function applyLink(view: EditorView) {
    if (!linkInput || !savedSelection) return;
    const url = linkInput.value.trim();
    const linkMark = view.state.schema.marks.link;
    if (!linkMark) return;

    const { from, to } = savedSelection;
    if (url) {
      const tr = view.state.tr.addMark(from, to, linkMark.create({ href: url }));
      view.dispatch(tr);
    }
    exitLinkMode(view);
  }

  function createTooltip(view: EditorView): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `milkdown-selection-toolbar hidden${useFixed ? ' click-outside-ignore' : ''}`;

    // Prevent mousedown on the toolbar from stealing editor focus or propagating
    // to document-level click-outside handlers (e.g. the grid's InteractionLayer).
    // Allow the link input to receive focus normally.
    el.addEventListener('mousedown', (e) => {
      if (e.target !== linkInput) {
        e.preventDefault();
      }
      e.stopPropagation();
    });

    // Buttons mode
    buttonsWrap = document.createElement('div');
    buttonsWrap.className = 'milkdown-selection-buttons';

    items = buildInlineItems(view.state.schema);

    items.forEach((item, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'milkdown-selection-separator';
        buttonsWrap!.appendChild(sep);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'milkdown-selection-btn';
      btn.title = item.title;
      btn.innerHTML = item.icon;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.id === 'link' && !isMarkActive(view.state, view.state.schema.marks.link!)) {
          enterLinkMode(view);
        } else {
          item.action(view);
          requestAnimationFrame(() => updateActiveStates(view.state));
        }
      });
      buttonsWrap!.appendChild(btn);
      buttons.push(btn);
    });

    el.appendChild(buttonsWrap);

    // Link input mode
    linkWrap = document.createElement('div');
    linkWrap.className = 'milkdown-selection-link-wrap';
    linkWrap.style.display = 'none';

    linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.className = 'milkdown-link-input';
    linkInput.placeholder = 'Enter link URL';
    linkWrap.appendChild(linkInput);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'milkdown-link-done-btn';
    doneBtn.textContent = 'Done';
    linkWrap.appendChild(doneBtn);

    el.appendChild(linkWrap);

    // Link input events
    linkInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        applyLink(view);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exitLinkMode(view);
      }
    });

    doneBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyLink(view);
    });

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (tooltip?.contains(target)) return;
      if (linkMode) {
        exitLinkMode(view);
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown, true);
    removeDocMouseDownListener = () => {
      document.removeEventListener('mousedown', onDocumentMouseDown, true);
      removeDocMouseDownListener = null;
    };

    return el;
  }

  function updateActiveStates(state: EditorState) {
    items.forEach((item, i) => {
      const btn = buttons[i];
      if (!btn) return;
      btn.classList.toggle('active', item.isActive(state));
    });
  }

  function updateTooltipPosition(view: EditorView) {
    if (!tooltip || !containerEl || (!savedSelection && !view.hasFocus())) return;

    const { state } = view;
    const { from, to } = savedSelection ?? state.selection;

    const startCoords = view.coordsAtPos(from);
    const endCoords = view.coordsAtPos(to);

    const tooltipWidth = tooltip.offsetWidth || 180;
    const tooltipHeight = tooltip.offsetHeight || 32;

    if (useFixed) {
      const editorRect = containerEl.getBoundingClientRect();

      // Clamp selection coords to the visible area of the editor (handles overflow:auto)
      const visTop = Math.max(startCoords.top, editorRect.top);
      const visBottom = Math.min(endCoords.bottom, editorRect.bottom);

      const selectionCenterX = (startCoords.left + endCoords.right) / 2;
      let left = selectionCenterX - tooltipWidth / 2;

      // Try above the visible selection first
      let top = visTop - tooltipHeight - 8;

      // If toolbar would go above the viewport, flip below the visible selection
      if (top < 4) {
        top = visBottom + 8;
      }

      // Clamp to viewport
      left = Math.max(4, Math.min(window.innerWidth - tooltipWidth - 4, left));
      top = Math.max(4, Math.min(window.innerHeight - tooltipHeight - 4, top));

      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    } else {
      const containerRect = containerEl.getBoundingClientRect();
      const scrollTop = containerEl.scrollTop;
      const scrollLeft = containerEl.scrollLeft;

      const selectionCenterX = (startCoords.left + endCoords.right) / 2;
      let left = selectionCenterX - containerRect.left + scrollLeft - tooltipWidth / 2;
      // Always place above the selection, clamped to the visible top of the container
      let top = startCoords.top - containerRect.top + scrollTop - tooltipHeight - 8;
      const minVisibleTop = scrollTop + 4;
      top = Math.max(minVisibleTop, top);

      left = Math.max(0, Math.min(containerEl.scrollWidth - tooltipWidth, left));

      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    }
  }

  function updateTooltip(view: EditorView) {
    if (!tooltip) return;

    // Don't reposition/hide while in link input mode
    if (linkMode) return;

    const { state } = view;
    const { selection } = state;
    const { empty } = selection;

    // Hide if no selection or editor not focused
    if (empty || !view.hasFocus()) {
      tooltip.classList.add('hidden');
      return;
    }

    // Don't show in code blocks
    const $from = selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'code_block') {
        tooltip.classList.add('hidden');
        return;
      }
    }

    tooltip.classList.remove('hidden');
    updateActiveStates(state);
    updateTooltipPosition(view);
  }

  return new Plugin({
    key: selectionToolbarPluginKey,
    props: {
      handleDOMEvents: {
        blur() {
          if (linkMode) return false;
          if (tooltip) {
            tooltip.classList.add('hidden');
          }
          return false;
        },
      },
    },
    view(editorView) {
      tooltip = createTooltip(editorView);

      containerEl =
        editorView.dom.closest('.milkdown-editor-wrap') instanceof HTMLElement
          ? (editorView.dom.closest('.milkdown-editor-wrap') as HTMLElement)
          : editorView.dom.parentElement;

      if (useFixed) {
        // Fixed positioning: append to body to avoid overflow clipping in grid cells
        tooltip.style.position = 'fixed';
        tooltip.style.zIndex = '1300';
        document.body.appendChild(tooltip);

        // Listen for scroll/resize to reposition
        const onViewportChange = () => updateTooltip(editorView);
        window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
        window.addEventListener('resize', onViewportChange, { passive: true });
        removeWindowListeners = () => {
          window.removeEventListener('scroll', onViewportChange, { capture: true });
          window.removeEventListener('resize', onViewportChange);
          removeWindowListeners = null;
        };
      } else {
        // Absolute positioning: append inside editor wrapper
        if (containerEl) {
          containerEl.style.position = 'relative';
          containerEl.appendChild(tooltip);
        }
      }

      updateTooltip(editorView);

      return {
        update(view) {
          updateTooltip(view);
        },
        destroy() {
          removeDocMouseDownListener?.();
          removeWindowListeners?.();
          tooltip?.remove();
          tooltip = null;
          containerEl = null;
          buttonsWrap = null;
          linkWrap = null;
          linkInput = null;
          items = [];
          buttons = [];
          linkMode = false;
          savedSelection = null;
        },
      };
    },
  });
}
