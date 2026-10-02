import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileSignInPage } from './MobileSignInPage';

const { createMobileAuthCode, signout } = vi.hoisted(() => ({
  createMobileAuthCode: vi.fn(),
  signout: vi.fn(),
}));
vi.mock('@teable/openapi', () => ({ createMobileAuthCode, signout }));
vi.mock('@teable/sdk/components', () => ({
  UserAvatar: ({ name }: { name: string }) => <div>{`avatar:${name}`}</div>,
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('next-seo', () => ({ NextSeo: () => null }));
vi.mock('@/components/TeableLogo', () => ({ TeableLogo: () => null }));
vi.mock('../components/LayoutMain', () => ({
  LayoutMain: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const request = { codeChallenge: 'c', state: 's', redirectUri: 'teable://auth/callback' };
const account = { id: 'usr1', name: 'Ada', email: 'ada@example.com', avatar: null };

describe('MobileSignInPage', () => {
  const renderPage = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MobileSignInPage account={account} request={request} />
      </QueryClientProvider>
    );

  beforeEach(() => {
    createMobileAuthCode.mockReset();
    signout.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, 'location', {
      value: { pathname: '/auth/mobile', search: '?code_challenge=c&state=s', assign: vi.fn() },
      writable: true,
    });
  });

  it('shows who the app would be signed in as', () => {
    renderPage();
    expect(screen.getByText('avatar:Ada')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth:mobile.authorize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth:mobile.switchAccount' })).toBeInTheDocument();
  });

  it('switching account signs out and reruns the login with this page as the redirect', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'auth:mobile.switchAccount' }));

    await waitFor(() => expect(signout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        `/auth/login?redirect=${encodeURIComponent('/auth/mobile?code_challenge=c&state=s')}`
      )
    );
    expect(createMobileAuthCode).not.toHaveBeenCalled();
  });

  it('reports a failed sign-out instead of leaving the page in limbo', async () => {
    signout.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'auth:mobile.switchAccount' }));

    await waitFor(() => expect(screen.getByText('auth:mobile.switchFailed')).toBeInTheDocument());
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
