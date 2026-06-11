import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';

const LINK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

export function createLinkClickPlugin(readonly: boolean): Plugin {
  let tooltip: HTMLDivElement | null = null;
  let currentHref: string | null = null;
  let scrollWrapEl: HTMLElement | null = null;
  let removeScrollListener: (() => void) | null = null;
  let removeWindowListeners: (() => void) | null = null;

  function createTooltip(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'milkdown-link-tooltip hidden';

    const icon = document.createElement('span');
    icon.className = 'milkdown-link-tooltip-icon';
    icon.innerHTML = LINK_ICON;
    el.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'milkdown-link-tooltip-text';
    el.appendChild(text);

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentHref) {
        window.open(currentHref, '_blank', 'noopener,noreferrer');
      }
    });

    return el;
  }

  function positionTooltip(view: EditorView, anchor: HTMLElement) {
    if (!tooltip) return;

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipHeight = tooltip.offsetHeight || 28;
    const tooltipWidth = tooltip.offsetWidth || 200;

    // Hide tooltip if the anchor is scrolled outside the visible editor area
    if (scrollWrapEl) {
      const wrapRect = scrollWrapEl.getBoundingClientRect();
      if (anchorRect.bottom < wrapRect.top || anchorRect.top > wrapRect.bottom) {
        tooltip.classList.add('hidden');
        return;
      }
    }

    // Position below the link
    let top = anchorRect.bottom + 4;
    let left = anchorRect.left;

    // If would go below scroll container or viewport, show above
    const clipBottom = scrollWrapEl
      ? scrollWrapEl.getBoundingClientRect().bottom
      : window.innerHeight - 8;
    if (top + tooltipHeight > clipBottom) {
      top = anchorRect.top - tooltipHeight - 4;
    }

    // Clamp horizontally
    left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, left));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function updateTooltip(view: EditorView) {
    if (!tooltip) return;

    const { state } = view;

    if (!view.hasFocus()) {
      tooltip.classList.add('hidden');
      currentHref = null;
      return;
    }

    // Find if cursor is inside a link mark
    const { $from } = state.selection;
    const linkMark = state.schema.marks.link;
    if (!linkMark) {
      tooltip.classList.add('hidden');
      currentHref = null;
      return;
    }

    const marks = $from.marks();
    const link = marks.find((m) => m.type === linkMark);
    if (!link) {
      tooltip.classList.add('hidden');
      currentHref = null;
      return;
    }

    const href = link.attrs.href as string;
    if (!href) {
      tooltip.classList.add('hidden');
      currentHref = null;
      return;
    }

    currentHref = href;

    // Update tooltip text
    const textEl = tooltip.querySelector('.milkdown-link-tooltip-text');
    if (textEl) {
      const maxLen = 50;
      textEl.textContent = href.length > maxLen ? href.slice(0, maxLen) + '...' : href;
    }

    tooltip.classList.remove('hidden');

    // Find the DOM anchor element at cursor position
    const dom = view.domAtPos($from.pos);
    const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
    const anchor = node?.closest('a') || node?.querySelector('a');
    if (anchor instanceof HTMLElement) {
      positionTooltip(view, anchor);
    }
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.classList.add('hidden');
      currentHref = null;
    }
  }

  return new Plugin({
    key: new PluginKey('milkdown-link-click'),
    props: {
      handleDOMEvents: {
        blur() {
          hideTooltip();
          return false;
        },
        click(_view, event) {
          if (!readonly) return false;
          if (!(event.target instanceof HTMLElement)) return false;

          const anchor = event.target.closest('a');
          if (!anchor) return false;

          const href = anchor.getAttribute('href');
          if (!href) return false;

          event.preventDefault();
          event.stopPropagation();
          window.open(href, '_blank', 'noopener,noreferrer');
          return true;
        },
      },
    },
    view(editorView) {
      tooltip = createTooltip();
      document.body.appendChild(tooltip);

      const scrollWrap = editorView.dom.closest('.milkdown-editor-wrap');
      scrollWrapEl = scrollWrap instanceof HTMLElement ? scrollWrap : null;

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

      return {
        update(view) {
          updateTooltip(view);
        },
        destroy() {
          removeScrollListener?.();
          removeWindowListeners?.();
          tooltip?.remove();
          tooltip = null;
          currentHref = null;
          scrollWrapEl = null;
        },
      };
    },
  });
}
