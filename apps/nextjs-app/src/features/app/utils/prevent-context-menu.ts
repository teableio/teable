import type { MouseEvent } from 'react';

/**
 * Suppress the browser's native context menu on app chrome, but allow it when the
 * user is acting on text — an editable target or an active (non-collapsed) text
 * selection. On Android the floating copy/cut/paste selection toolbar is triggered
 * by the `contextmenu` event, so a blanket `preventDefault()` kills it.
 *
 * React synthetic events bubble through the React tree (including portals), so a
 * layout-level `onContextMenu` also receives events from portaled record dialogs;
 * without this guard it would suppress text selection inside every modal (T5385).
 */
export const preventContextMenuUnlessText = (e: MouseEvent) => {
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('input, textarea, [contenteditable]')) return;
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  if (selection && !selection.isCollapsed) return;
  e.preventDefault();
};
