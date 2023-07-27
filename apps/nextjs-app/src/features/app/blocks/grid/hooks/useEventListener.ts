import { useRef, useEffect } from 'react';

export const useEventListener = <K extends keyof HTMLElementEventMap>(
  eventName: K,
  handler: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void,
  element: HTMLElement | Window | null,
  passive: boolean,
  capture = false
) => {
  const savedHandler = useRef<(this: HTMLElement, ev: HTMLElementEventMap[K]) => void>();

  savedHandler.current = handler;
  useEffect(() => {
    if (element === null || element.addEventListener === undefined) return;
    const el = element as HTMLElement;
    const eventListener = (event: HTMLElementEventMap[K]) => {
      savedHandler.current?.call(el, event);
    };

    el.addEventListener(eventName, eventListener, { passive, capture });

    return () => {
      el.removeEventListener(eventName, eventListener, { capture });
    };
  }, [eventName, element, passive, capture]);
};
