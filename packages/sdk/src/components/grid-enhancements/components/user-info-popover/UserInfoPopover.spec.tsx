import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import { act, render, screen } from '@testing-library/react';
import { merge } from 'lodash';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContext } from '../../../../context/app/AppContext';
import { defaultLocale } from '../../../../context/app/i18n';
import { useUserInfoPopoverStore } from './user-info-popover';
import { UserInfoPopover } from './UserInfoPopover';

const zhLocale = merge({}, defaultLocale, zhSdk);

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppContext.Provider value={{ locale: zhLocale, lang: 'zh' }}>{children}</AppContext.Provider>
);

const position = { x: 0, y: 0, width: 80, height: 24 };

const open = (user: { id: string; name: string; email?: string; isSystem?: boolean }) =>
  act(() => useUserInfoPopoverStore.getState().openPopover({ id: 'grid', user, position }));

describe('UserInfoPopover', () => {
  afterEach(() => act(() => useUserInfoPopoverStore.getState().closePopover()));

  it('labels an App user and keeps their email out of the card', () => {
    render(<UserInfoPopover id="grid" />, { wrapper });
    open({ id: 'apu_1', name: 'Zoe', email: 'zoe@example.com' });

    expect(screen.getByText('Zoe')).toBeInTheDocument();
    expect(screen.getByText('应用用户')).toBeInTheDocument();
    expect(screen.queryByText('zoe@example.com')).toBeNull();
    expect(document.querySelector('svg.lucide-app-window-mac')).toBeTruthy();
  });

  it('still shows a Teable member with their email and no label', () => {
    render(<UserInfoPopover id="grid" />, { wrapper });
    open({ id: 'usr1', name: 'Zoe', email: 'zoe@example.com' });

    expect(screen.getByText('zoe@example.com')).toBeInTheDocument();
    expect(screen.queryByText('应用用户')).toBeNull();
  });
});
