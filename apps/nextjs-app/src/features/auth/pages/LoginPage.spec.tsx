import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const { router, disallow } = vi.hoisted(() => ({
  router: {
    query: {} as Record<string, string>,
    pathname: '/auth/login',
    push: vi.fn(),
    replace: vi.fn(),
  },
  disallow: { value: false as boolean | undefined },
}));

vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ children, href: _href, shallow: _shallow, ...rest }: Record<string, unknown>) => (
    <a {...(rest as object)}>{children as ReactNode}</a>
  ),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('next-seo', () => ({ NextSeo: () => null }));
vi.mock('@teable/ui-lib/shadcn', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));
vi.mock('@/components/TeableLogo', () => ({ TeableLogo: () => null }));
vi.mock('@/features/app/hooks/useAutoFavicon', () => ({ useAutoFavicon: () => undefined }));
vi.mock('@/features/app/hooks/useBrand', () => ({ useBrand: () => ({ brandName: 'Teable' }) }));
vi.mock('@/features/app/hooks/useEnv', () => ({
  useEnv: () => ({ passwordLoginDisabled: false }),
}));
vi.mock('@/features/app/hooks/useInitializationZodI18n', () => ({
  useInitializationZodI18n: () => undefined,
}));
vi.mock('../components/AppleAuthError', () => ({ AppleAuthError: () => null }));
vi.mock('../components/DescContent', () => ({ DescContent: () => null }));
vi.mock('../components/SignForm', () => ({
  SignForm: ({ type }: { type: string }) => <div data-testid="sign-form">{type}</div>,
}));
vi.mock('../components/SocialAuth', () => ({ SocialAuth: () => null }));
vi.mock('../components/Terms', () => ({ Terms: () => null }));
vi.mock('../useDisallowSignUp', () => ({ useDisallowSignUp: () => disallow.value }));

const appConsent = (platform: string) =>
  `/auth/mobile?code_challenge=${'c'.repeat(43)}&state=s&redirect_uri=teable%3A%2F%2Fauth%2Fcallback&platform=${platform}`;

describe('LoginPage sign-up entry', () => {
  beforeEach(() => {
    router.query = {};
    router.pathname = '/auth/login';
    router.replace.mockReset();
    disallow.value = false;
  });

  it('offers sign-up on an ordinary login', () => {
    render(<LoginPage />);
    expect(screen.getByText('auth:button.signup')).toBeInTheDocument();
  });

  it('hides sign-up while the sign-in heads back to the iOS app', () => {
    router.query = { redirect: appConsent('ios') };
    render(<LoginPage />);
    expect(screen.queryByText('auth:button.signup')).not.toBeInTheDocument();
    expect(screen.getByText('auth:button.signin')).toBeInTheDocument();
  });

  it('keeps sign-up for the Android app', () => {
    router.query = { redirect: appConsent('android') };
    render(<LoginPage />);
    expect(screen.getByText('auth:button.signup')).toBeInTheDocument();
  });

  it('turns the signup route into sign-in for the iOS app', () => {
    router.pathname = '/auth/signup';
    router.query = { redirect: appConsent('ios') };
    render(<LoginPage />);
    expect(screen.getByTestId('sign-form')).toHaveTextContent('signin');
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/auth/login' }),
      undefined,
      { shallow: true }
    );
  });
});
