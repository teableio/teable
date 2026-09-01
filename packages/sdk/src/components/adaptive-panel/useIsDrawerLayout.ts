import { useIsHydrated, useIsMobile } from '../../hooks';

/**
 * True when floating panels should render as bottom drawers.
 *
 * This is the single place the narrow-viewport decision is made for panel
 * shape. Nothing else in the toolbar tree may branch on a breakpoint of its
 * own - see the consistency requirements in the drawer spec.
 *
 * Gated on hydration on purpose: the server has no viewport, so a panel that
 * picked its shape during SSR would hydrate into the other one. Because the
 * trigger button renders identically either way and the panel starts closed,
 * deferring to the client costs nothing visually.
 */
export const useIsDrawerLayout = () => {
  const isMobile = useIsMobile();
  const isHydrated = useIsHydrated();
  return isMobile && isHydrated;
};

/**
 * Opt-in variant. Panels shared with non-toolbar surfaces (the field-setting
 * panel, the API query builder, link-field options) must not turn into
 * drawers just because the window is narrow, so drawer rendering is only
 * enabled where a caller explicitly asked for it.
 */
export const useIsDrawerPanel = (responsive?: boolean) => {
  const isDrawerLayout = useIsDrawerLayout();
  return Boolean(responsive) && isDrawerLayout;
};
