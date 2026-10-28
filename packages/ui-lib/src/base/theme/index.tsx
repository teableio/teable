import { ThemeProvider, useTheme as useNextTheme } from 'next-themes';
import { useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';

export { ThemeProvider };

type IViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

// The theme the latest reveal is switching to, and how many reveals have yet to finish
let revealingTheme: string | undefined;
let openReveals = 0;

// The new theme drops over the old one from the top edge (the reveal itself is in the app's
// global.css, keyed on this attribute). Without the View Transition API, or with reduced motion,
// the theme just changes.
const switchThemeWithReveal = (theme: string | undefined, apply: () => void) => {
  const doc = document as IViewTransitionDocument;
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply();
    return;
  }
  // A second request for the theme already on its way would start a new transition, and the
  // browser abandons the first one mid-reveal
  if (theme !== undefined && theme === revealingTheme) {
    return;
  }
  const root = document.documentElement;
  revealingTheme = theme;
  openReveals += 1;
  root.dataset.themeTransition = '';
  // next-themes puts the class on <html> in an effect; flushSync commits it, effects included,
  // before the browser captures the new state — otherwise the reveal would show the old theme.
  doc
    .startViewTransition(() => flushSync(apply))
    .finished.finally(() => {
      openReveals -= 1;
      // An abandoned transition finishes early; the attribute stays for the one replacing it
      if (openReveals === 0) {
        revealingTheme = undefined;
        delete root.dataset.themeTransition;
      }
    });
};

// next-themes keeps `theme` and `resolvedTheme` on the stored preference while
// `forcedTheme` is set (pacocoursey/next-themes#252). Canvas and chart code picks
// its colors from resolvedTheme, so a forced page has to report the forced value.
export const useTheme = () => {
  const context = useNextTheme();
  const { forcedTheme, resolvedTheme, systemTheme, setTheme: setThemeNow } = context;
  const setTheme = useCallback<typeof setThemeNow>(
    (value) => {
      const theme = typeof value === 'string' ? value : undefined;
      // Nothing to reveal when the page would look the same: a forced theme, or a pick that comes
      // out as the theme already showing (the current one, or System on a system that matches it)
      const shown = theme === 'system' ? systemTheme : theme;
      if (forcedTheme || (shown !== undefined && shown === resolvedTheme)) {
        setThemeNow(value);
        return;
      }
      switchThemeWithReveal(theme, () => setThemeNow(value));
    },
    [forcedTheme, resolvedTheme, setThemeNow, systemTheme]
  );
  return useMemo(
    () =>
      forcedTheme
        ? { ...context, setTheme, theme: forcedTheme, resolvedTheme: forcedTheme }
        : { ...context, setTheme },
    [context, forcedTheme, setTheme]
  );
};
