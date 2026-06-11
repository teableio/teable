import { setBlockType, wrapIn, lift } from '@milkdown/prose/commands';
import type { Node as ProseMirrorNode, NodeType, Schema } from '@milkdown/prose/model';
import { liftListItem, wrapInList } from '@milkdown/prose/schema-list';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  TextQuote,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

interface ToolbarItem {
  id: string;
  icon: string;
  title: string;
  action: (view: EditorView) => boolean;
  isActive?: (state: EditorState) => boolean;
}

function isBlockType(state: EditorState, type: NodeType, attrs?: Record<string, unknown>): boolean {
  const { $from } = state.selection;
  const node = $from.node($from.depth);
  if (!node) return false;
  if (node.type !== type) return false;
  if (attrs) {
    return Object.entries(attrs).every(([k, v]) => node.attrs[k] === v);
  }
  return true;
}

function isWrappedIn(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === type) return true;
  }
  return false;
}

function isTaskListItem(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'list_item' && node.attrs.checked != null) return true;
  }
  return false;
}

/**
 * Reset current block to a plain paragraph by lifting out of any
 * list / blockquote wrappers and converting heading / code_block.
 * Each step dispatches a transaction so `view.state` is up-to-date
 * for the next step.
 */
function liftOutOfList(
  view: EditorView,
  listItemType: NodeType,
  wrapperTypes: (NodeType | undefined)[]
): void {
  for (let i = 0; i < 10; i++) {
    const inList = wrapperTypes.some((t) => t && isWrappedIn(view.state, t));
    if (!inList) break;
    liftListItem(listItemType)(view.state, view.dispatch.bind(view));
  }
}

function liftOutOfWrapper(view: EditorView, wrapperType: NodeType): void {
  for (let i = 0; i < 10; i++) {
    if (!isWrappedIn(view.state, wrapperType)) break;
    lift(view.state, view.dispatch.bind(view));
  }
}

function resetBlock(view: EditorView): void {
  const { schema } = view.state;
  const {
    list_item: listItemType,
    bullet_list: bulletList,
    ordered_list: orderedList,
    blockquote,
    paragraph,
  } = schema.nodes;

  if (listItemType) {
    liftOutOfList(view, listItemType, [bulletList, orderedList]);
  }

  if (blockquote) {
    liftOutOfWrapper(view, blockquote);
  }

  if (paragraph && !isBlockType(view.state, paragraph)) {
    setBlockType(paragraph)(view.state, view.dispatch.bind(view));
  }
}

function setListItemChecked(
  tr: Transaction,
  doc: ProseMirrorNode,
  pos: number,
  listItemType: NodeType,
  checked: boolean | null
): Transaction {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type === listItemType) {
      const nodePos = $pos.before(d);
      return tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked });
    }
  }
  return tr;
}

const ICONS: Record<string, LucideIcon> = {
  paragraph: Pilcrow,
  blockquote: TextQuote,
  codeBlock: Code,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  orderedList: ListOrdered,
  bulletList: List,
  taskList: ListChecks,
};

function createSvgIcon(id: string): string {
  const Icon = ICONS[id];
  if (!Icon) return '';
  return renderToStaticMarkup(createElement(Icon, { size: 16, strokeWidth: 1.75 }));
}

function buildToolbarItems(schema: Schema): ToolbarItem[] {
  const items: ToolbarItem[] = [];

  if (schema.nodes.paragraph) {
    items.push({
      id: 'paragraph',
      icon: createSvgIcon('paragraph'),
      title: 'Paragraph',
      action: (view) => {
        resetBlock(view);
        return true;
      },
      isActive: (state) =>
        isBlockType(state, schema.nodes.paragraph!) &&
        !isWrappedIn(state, schema.nodes.blockquote!) &&
        !isWrappedIn(state, schema.nodes.bullet_list!) &&
        !isWrappedIn(state, schema.nodes.ordered_list!),
    });
  }

  if (schema.nodes.blockquote) {
    items.push({
      id: 'blockquote',
      icon: createSvgIcon('blockquote'),
      title: 'Blockquote',
      action: (view) => {
        if (isWrappedIn(view.state, schema.nodes.blockquote!)) {
          resetBlock(view);
        } else {
          resetBlock(view);
          wrapIn(schema.nodes.blockquote!)(view.state, view.dispatch.bind(view));
        }
        return true;
      },
      isActive: (state) => isWrappedIn(state, schema.nodes.blockquote!),
    });
  }

  if (schema.nodes.code_block) {
    items.push({
      id: 'codeBlock',
      icon: createSvgIcon('codeBlock'),
      title: 'Code Block',
      action: (view) => {
        if (isBlockType(view.state, schema.nodes.code_block!)) {
          resetBlock(view);
        } else {
          resetBlock(view);
          setBlockType(schema.nodes.code_block!)(view.state, view.dispatch.bind(view));
        }
        return true;
      },
      isActive: (state) => isBlockType(state, schema.nodes.code_block!),
    });
  }

  if (schema.nodes.heading) {
    for (const level of [1, 2, 3] as const) {
      items.push({
        id: `h${level}`,
        icon: createSvgIcon(`h${level}`),
        title: `Heading ${level}`,
        action: (view) => {
          if (isBlockType(view.state, schema.nodes.heading!, { level })) {
            resetBlock(view);
          } else {
            resetBlock(view);
            setBlockType(schema.nodes.heading!, { level })(view.state, view.dispatch.bind(view));
          }
          return true;
        },
        isActive: (state) => isBlockType(state, schema.nodes.heading!, { level }),
      });
    }
  }

  if (schema.nodes.ordered_list && schema.nodes.list_item) {
    items.push({
      id: 'orderedList',
      icon: createSvgIcon('orderedList'),
      title: 'Ordered List',
      action: (view) => {
        if (isWrappedIn(view.state, schema.nodes.ordered_list!)) {
          resetBlock(view);
        } else {
          resetBlock(view);
          wrapInList(schema.nodes.ordered_list!)(view.state, view.dispatch.bind(view));
        }
        return true;
      },
      isActive: (state) => isWrappedIn(state, schema.nodes.ordered_list!),
    });
  }

  if (schema.nodes.bullet_list && schema.nodes.list_item) {
    items.push({
      id: 'bulletList',
      icon: createSvgIcon('bulletList'),
      title: 'Bullet List',
      action: (view) => {
        if (isWrappedIn(view.state, schema.nodes.bullet_list!) && !isTaskListItem(view.state)) {
          resetBlock(view);
        } else {
          resetBlock(view);
          wrapInList(schema.nodes.bullet_list!)(view.state, view.dispatch.bind(view));
        }
        return true;
      },
      isActive: (state) => isWrappedIn(state, schema.nodes.bullet_list!) && !isTaskListItem(state),
    });
  }

  if (schema.nodes.list_item && schema.nodes.bullet_list) {
    items.push({
      id: 'taskList',
      icon: createSvgIcon('taskList'),
      title: 'Task List',
      action: (view) => {
        if (isTaskListItem(view.state)) {
          resetBlock(view);
        } else {
          resetBlock(view);
          // Wrap in bullet list then set checked
          const bulletList = schema.nodes.bullet_list!;
          const listItem = schema.nodes.list_item!;
          let capturedTr: Transaction | null = null;
          const canWrap = wrapInList(bulletList)(view.state, (t) => {
            capturedTr = t;
          });
          if (canWrap && capturedTr) {
            const tr: Transaction = capturedTr;
            const mappedPos = tr.mapping.map(view.state.selection.from);
            const finalTr = setListItemChecked(tr, tr.doc, mappedPos, listItem, false);
            view.dispatch(finalTr);
          }
        }
        return true;
      },
      isActive: (state) => isTaskListItem(state),
    });
  }

  return items;
}

export const floatingToolbarPluginKey = new PluginKey('milkdown-floating-toolbar');

export function createFloatingToolbarPlugin(): Plugin {
  let tooltip: HTMLDivElement | null = null;
  let panel: HTMLDivElement | null = null;
  let toggleButton: HTMLButtonElement | null = null;
  let scrollWrapEl: HTMLElement | null = null;
  let mountEl: HTMLElement | null = null;
  let items: ToolbarItem[] = [];
  let buttons: HTMLButtonElement[] = [];
  let expanded = false;
  let removeDocMouseDownListener: (() => void) | null = null;
  let removeScrollListener: (() => void) | null = null;
  let removeWindowListeners: (() => void) | null = null;

  const blockPriority = [
    'taskList',
    'orderedList',
    'bulletList',
    'h1',
    'h2',
    'h3',
    'blockquote',
    'codeBlock',
  ];

  function getCurrentLineItem(state: EditorState): ToolbarItem | undefined {
    for (const id of blockPriority) {
      const item = items.find((it) => it.id === id);
      if (item?.isActive?.(state)) return item;
    }

    const paragraph = items.find((it) => it.id === 'paragraph');
    if (paragraph) return paragraph;

    return items.find((it) => it.isActive?.(state));
  }

  function updateToggleButtonState(state: EditorState) {
    if (!toggleButton) return;
    const current = getCurrentLineItem(state);
    if (!current) return;
    toggleButton.innerHTML = current.icon;
    toggleButton.title = current.title;
    toggleButton.setAttribute('aria-label', current.title);
  }

  function createTooltip(view: EditorView): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'milkdown-floating-toolbar';
    el.style.display = 'none';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'milkdown-toolbar-toggle';
    toggleBtn.title = 'Formatting';
    toggleBtn.innerHTML = createSvgIcon('paragraph');
    toggleBtn.setAttribute('aria-label', 'Formatting');
    toggleBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      expanded = !expanded;
      el.classList.toggle('expanded', expanded);
      if (expanded) {
        view.focus();
        updateActiveStates(view.state);
      }
    });
    el.appendChild(toggleBtn);
    toggleButton = toggleBtn;

    panel = document.createElement('div');
    panel.className = 'milkdown-toolbar-panel';
    el.appendChild(panel);

    items = buildToolbarItems(view.state.schema);

    items.forEach((item, i) => {
      if (i === 3 || i === 6) {
        const sep = document.createElement('div');
        sep.className = 'milkdown-toolbar-separator';
        panel?.appendChild(sep);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'milkdown-toolbar-btn';
      btn.title = item.title;
      btn.innerHTML = item.icon;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.action(view);
        updateActiveStates(view.state);
      });
      panel?.appendChild(btn);
      buttons.push(btn);
    });

    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!expanded || !tooltip) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (tooltip.contains(target)) return;
      expanded = false;
      tooltip.classList.remove('expanded');
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
      if (!btn || !item.isActive) return;
      btn.classList.toggle('active', item.isActive(state));
    });
    updateToggleButtonState(state);
  }

  function updateToolbarPosition(view: EditorView) {
    if (!tooltip || !mountEl) return;
    const cursorRect = view.coordsAtPos(view.state.selection.from);
    const mountRect = mountEl.getBoundingClientRect();
    const editorRect = scrollWrapEl?.getBoundingClientRect() ?? view.dom.getBoundingClientRect();
    const toolbarHeight = tooltip.offsetHeight || 30;

    // All coordinates relative to mountEl
    const minTop = editorRect.top - mountRect.top;
    const maxTop = Math.max(minTop, editorRect.bottom - mountRect.top - toolbarHeight);
    const desiredTop = cursorRect.top - mountRect.top;
    const top = Math.max(minTop, Math.min(maxTop, desiredTop));

    tooltip.style.top = `${top}px`;
  }

  function isMultiLineSelection(view: EditorView): boolean {
    const { selection } = view.state;
    if (selection.empty) return false;
    const startCoords = view.coordsAtPos(selection.from);
    const endCoords = view.coordsAtPos(selection.to);
    return Math.abs(endCoords.top - startCoords.top) > 2;
  }

  function updateTooltip(view: EditorView) {
    if (!tooltip) return;

    const { state } = view;
    if (!view.hasFocus() || isMultiLineSelection(view)) {
      tooltip.style.display = 'none';
      expanded = false;
      tooltip.classList.remove('expanded');
      return;
    }
    tooltip.style.display = '';
    updateToolbarPosition(view);
    updateActiveStates(state);
  }

  return new Plugin({
    key: floatingToolbarPluginKey,
    props: {
      handleDOMEvents: {
        blur() {
          if (tooltip) {
            tooltip.style.display = 'none';
            expanded = false;
            tooltip.classList.remove('expanded');
          }
          return false;
        },
        mousedown(view, event) {
          if (!(event instanceof MouseEvent)) return false;
          if (event.button !== 0) return false;

          const target = event.target;
          if (!(target instanceof HTMLElement)) return false;

          const taskItem = target.closest('li[data-item-type="task"][data-checked]');
          if (!(taskItem instanceof HTMLElement)) return false;

          const rect = taskItem.getBoundingClientRect();
          const checkboxHitWidth = 24;
          if (event.clientX > rect.left + checkboxHitWidth) return false;

          const pos = view.posAtDOM(taskItem, 0);
          const { state } = view;
          const listItemType = state.schema.nodes.list_item;
          if (!listItemType) return false;

          const checkedAttr = taskItem.getAttribute('data-checked');
          if (checkedAttr !== 'true' && checkedAttr !== 'false') return false;
          const nextChecked = checkedAttr !== 'true';

          const tr = setListItemChecked(state.tr, state.doc, pos, listItemType, nextChecked);
          if (tr.docChanged) {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch(tr);
            updateActiveStates(view.state);
            view.focus();
            return true;
          }

          return false;
        },
      },
    },
    view(editorView) {
      tooltip = createTooltip(editorView);

      const scrollWrap = editorView.dom.closest('.milkdown-editor-wrap');
      scrollWrapEl = scrollWrap instanceof HTMLElement ? scrollWrap : null;

      // Mount inside the editor's positioned parent so ancestor overflow clips naturally
      mountEl = scrollWrapEl?.parentElement ?? editorView.dom.parentElement;
      (mountEl ?? document.body).appendChild(tooltip);

      if (scrollWrapEl) {
        const onScroll = () => updateTooltip(editorView);
        scrollWrapEl.addEventListener('scroll', onScroll, { passive: true });
        removeScrollListener = () => {
          scrollWrapEl?.removeEventListener('scroll', onScroll);
          removeScrollListener = null;
        };
      }

      const onViewportChange = () => updateTooltip(editorView);
      window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
      window.addEventListener('resize', onViewportChange, { passive: true });
      removeWindowListeners = () => {
        window.removeEventListener('scroll', onViewportChange, { capture: true });
        window.removeEventListener('resize', onViewportChange);
        removeWindowListeners = null;
      };

      updateTooltip(editorView);

      return {
        update(view) {
          updateTooltip(view);
        },
        destroy() {
          removeDocMouseDownListener?.();
          removeScrollListener?.();
          removeWindowListeners?.();
          tooltip?.remove();
          tooltip = null;
          panel = null;
          toggleButton = null;
          scrollWrapEl = null;
          mountEl = null;
          items = [];
          buttons = [];
          expanded = false;
        },
      };
    },
  });
}
