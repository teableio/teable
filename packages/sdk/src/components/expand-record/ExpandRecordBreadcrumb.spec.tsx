import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../context/app/AppContext';
import { defaultLocale } from '../../context/app/i18n';
import { ExpandRecordBreadcrumb } from './ExpandRecordBreadcrumb';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppContext.Provider value={{ locale: defaultLocale, lang: 'en' }}>
    {children}
  </AppContext.Provider>
);
const render = (ui: ReactElement) => rtlRender(ui, { wrapper });

const crumbsOf = (titles: string[]) =>
  titles.map((title) => ({ title, tableName: `${title} table`, close: vi.fn() }));

describe('ExpandRecordBreadcrumb', () => {
  it('goes back to a record by closing the one stacked right over it', () => {
    const crumbs = crumbsOf(['Deal', 'Company', 'Contact']);
    render(<ExpandRecordBreadcrumb crumbs={crumbs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
    expect(crumbs[1].close).toHaveBeenCalledTimes(1);
    expect(crumbs[2].close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Company' }));
    expect(crumbs[2].close).toHaveBeenCalledTimes(1);
  });

  it('shows the open record last, as text rather than a button', () => {
    render(<ExpandRecordBreadcrumb crumbs={crumbsOf(['Deal', 'Company'])} />);

    expect(screen.queryByRole('button', { name: 'Company' })).toBeNull();
    expect(screen.getByText('Company').getAttribute('aria-current')).toBe('page');
  });

  it('folds every level between the first and the open one into an ellipsis past three', () => {
    const crumbs = crumbsOf(['Deal', 'Company', 'Contact', 'Task']);
    render(<ExpandRecordBreadcrumb crumbs={crumbs} />);

    expect(screen.getByRole('button', { name: 'Deal' })).toBeTruthy();
    expect(screen.getByText('Task')).toBeTruthy();
    expect(screen.queryByText('Company')).toBeNull();
    expect(screen.queryByText('Contact')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
  });
});
