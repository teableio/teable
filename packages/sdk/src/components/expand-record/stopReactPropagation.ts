import type { SyntheticEvent } from 'react';

/**
 * Keeps a press inside the record panel from reaching handlers the opener's React tree puts
 * around it (the grid, a kanban card's drag listeners), while the native event still bubbles to
 * `document`. Popovers opened in the panel (the history filters, a select editor) close on a
 * press outside them only when its `pointerdown` and `mousedown` reach `document`;
 * `stopPropagation()` kept them from getting there, so the popovers stayed open when the panel's
 * blank space or another filter was pressed (T8774). React checks `isPropagationStopped()` before
 * each handler up the tree, so only the React side stops here.
 */
export const stopReactPropagation = (event: SyntheticEvent) => {
  event.isPropagationStopped = () => true;
};
