import { createContext, useContext } from 'react';

export interface IDrawerStackContext {
  /** 0 = not inside a drawer, 1 = top-level drawer, 2 = stacked selector. */
  depth: number;
  /** Closes the drawer at this depth. No-op outside a drawer. */
  close: () => void;
}

const noop = () => undefined;

export const DrawerStackContext = createContext<IDrawerStackContext>({ depth: 0, close: noop });

export const useDrawerStack = () => useContext(DrawerStackContext);

/**
 * Whether the calling component is rendered inside a drawer.
 *
 * Nested selectors branch on this rather than on the viewport, so a select
 * that happens to be on a narrow screen but inside a popover (or inside the
 * right-hand field-setting sheet) keeps its popover.
 */
export const useInDrawer = () => useDrawerStack().depth > 0;
