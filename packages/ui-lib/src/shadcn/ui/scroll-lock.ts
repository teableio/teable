import type * as React from 'react';

/**
 * Lets a floating list scroll while a modal dialog or sheet is open around it.
 *
 * A modal dialog locks page scrolling with react-remove-scroll, which listens for `wheel` and
 * `touchmove` on `document` and cancels any whose target is outside the dialog. A popover or
 * menu portaled to `body` is outside it, so its list stopped scrolling inside dialogs: the
 * record editor's select and member lists, the create-record dialog (T7269, T7456, T8535), and
 * pickers in other dialogs. Each was fixed by hand before, and every new dialog or list brought
 * it back. Stopped here, the event never reaches `document`; the browser still scrolls the list.
 * The caller's own handlers run first.
 */
export const keepScrollingUnderLocks = <T extends HTMLElement>(handlers: {
  onWheel?: React.WheelEventHandler<T>;
  onTouchMove?: React.TouchEventHandler<T>;
}) => ({
  onWheel: (event: React.WheelEvent<T>) => {
    handlers.onWheel?.(event);
    event.stopPropagation();
  },
  onTouchMove: (event: React.TouchEvent<T>) => {
    handlers.onTouchMove?.(event);
    event.stopPropagation();
  },
});
