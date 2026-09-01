/**
 * Decide whether a clipboard paste should go to the grid selection handler.
 *
 * Link/select pickers keep a hidden focus input so Ctrl/Cmd+V can still paste
 * cell values. Visible inputs (search boxes, text editors) keep native paste.
 */
export const shouldForwardPasteToGrid = ({
  isEditing,
  eventTarget,
  hiddenFocusEl,
}: {
  isEditing: boolean;
  eventTarget: EventTarget | null;
  hiddenFocusEl: HTMLElement | null;
}): boolean => {
  if (!isEditing) {
    return true;
  }

  if (eventTarget == null || eventTarget === hiddenFocusEl) {
    return true;
  }

  if (!(eventTarget instanceof HTMLElement)) {
    return true;
  }

  const tagName = eventTarget.tagName;
  const isContentEditable = eventTarget.isContentEditable || eventTarget.contentEditable === 'true';
  return tagName !== 'INPUT' && tagName !== 'TEXTAREA' && !isContentEditable;
};
