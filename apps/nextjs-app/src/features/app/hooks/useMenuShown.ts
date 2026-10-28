import type { AriaAttributes } from 'react';
import { useEffect, useState } from 'react';

/** Well past any menu's fade: by then a menu that is gone without an event has gone. */
const MENU_FADE_FALLBACK_MS = 1000;

/**
 * Whether the menu a trigger opens is on screen: open, or still fading out after it closed. Takes
 * the trigger's props, which Radix fills in for an `asChild` trigger. Rows that reveal their menu
 * buttons on hover keep them while this holds: the menu is placed against its button, so a button
 * hidden or moved mid-fade drags the fading menu along, to the page's corner if it is hidden.
 */
export const useMenuShown = ({
  'aria-expanded': ariaExpanded,
  'aria-controls': controls,
}: Pick<AriaAttributes, 'aria-expanded' | 'aria-controls'>) => {
  const expanded = ariaExpanded === true;
  // The trigger names its menu only while open: keep the name for the fade.
  const [menuId, setMenuId] = useState<string>();
  if (expanded && controls && controls !== menuId) setMenuId(controls);

  useEffect(() => {
    if (expanded || !menuId) return;
    const menu = document.getElementById(menuId);
    if (!menu) {
      setMenuId(undefined);
      return;
    }
    // The fade ends, or is cut short (cancelled) and the menu goes at once.
    const onEnd = (event: AnimationEvent) => {
      if (event.target === menu) setMenuId(undefined);
    };
    menu.addEventListener('animationend', onEnd);
    menu.addEventListener('animationcancel', onEnd);
    // Whatever else happens, a menu no longer on the page isn't shown.
    const fallback = setTimeout(() => {
      if (!menu.isConnected) setMenuId(undefined);
    }, MENU_FADE_FALLBACK_MS);
    return () => {
      menu.removeEventListener('animationend', onEnd);
      menu.removeEventListener('animationcancel', onEnd);
      clearTimeout(fallback);
    };
  }, [expanded, menuId]);

  return expanded || menuId !== undefined;
};
