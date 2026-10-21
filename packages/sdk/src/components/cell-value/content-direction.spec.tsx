import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppContext } from '../../context/app/AppContext';
import type { ILocale } from '../../context/app/i18n';
import { CellLink } from './cell-link';
import { SelectTag } from './cell-select/SelectTag';
import { UserTag } from './cell-user';
import { OverflowTooltip } from './components';

const withLang = (lang: string | undefined, ui: ReactNode) =>
  render(<AppContext.Provider value={{ lang, locale: {} as ILocale }}>{ui}</AppContext.Provider>);

const ARABIC = 'مرحبا';

const SUBJECTS: [string, ReactNode][] = [
  ['OverflowTooltip', <OverflowTooltip key="t" text={ARABIC} />],
  ['SelectTag', <SelectTag key="s" label={ARABIC} />],
  ['UserTag', <UserTag key="u" name={ARABIC} />],
  ['CellLink', <CellLink key="l" value={{ id: 'rec1', title: ARABIC }} />],
];

describe('content direction opt-in', () => {
  // The whole point of the language gate: every other locale must render the
  // exact same markup it rendered before content direction existed.
  it.each(['en', 'zh', 'ja', 'tr', undefined])('emits no dir attribute for %s', (lang) => {
    for (const [name, ui] of SUBJECTS) {
      const { container, unmount } = withLang(lang, ui);
      expect(container.querySelectorAll('[dir]'), name).toHaveLength(0);
      unmount();
    }
  });

  // Regression: `useContentDir` used to go through `useTranslation`, which
  // destructures AppContext. Surfaces that mount their own React root (the
  // editor's mention popup) see no provider, so labelling a component's text
  // direction started crashing a tree that never asked for translations — and
  // it crashed in every language, not just the RTL ones.
  it('renders without an AppContext provider at all', () => {
    // CellLink is excluded on purpose: it already read the context before any of
    // this, for the "record deleted" label. The invariant here is narrower and
    // the one that actually broke — a component that did NOT need the provider
    // must not start needing it just because its text now declares a direction.
    const standalone = SUBJECTS.filter(([name]) => name !== 'CellLink');
    for (const [name, ui] of standalone) {
      expect(() => {
        const { container, unmount } = render(<>{ui}</>);
        expect(container.querySelectorAll('[dir]'), name).toHaveLength(0);
        unmount();
      }, name).not.toThrow();
    }
  });

  it.each(['ar', 'ar-EG', 'he', 'he-IL'])('hands the content its own direction for %s', (lang) => {
    for (const [name, ui] of SUBJECTS) {
      const { container, unmount } = withLang(lang, ui);
      const dirs = [...container.querySelectorAll('[dir]')].map((el) => el.getAttribute('dir'));
      expect(dirs.length, name).toBeGreaterThan(0);
      // `auto` rather than `rtl`: a user reading the UI in Arabic or Hebrew who
      // types English into a field still gets left-to-right on that field.
      expect(new Set(dirs), name).toEqual(new Set(['auto']));
      unmount();
    }
  });
});
