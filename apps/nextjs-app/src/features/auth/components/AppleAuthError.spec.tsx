import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppleAuthError } from './AppleAuthError';
import { SocialAuth } from './SocialAuth';

const { query } = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
}));
vi.mock('next/router', () => ({ useRouter: () => ({ query }) }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/app/hooks/useEnv', () => ({
  useEnv: () => ({ socialAuthProviders: ['apple'], passwordLoginDisabled: false }),
}));

const diagnosticId = '12345678-1234-4123-8123-123456789abc';

describe('AppleAuthError', () => {
  beforeEach(() => {
    Object.keys(query).forEach((key) => delete query[key]);
  });

  it('shows the specific failure without a diagnostic reference or copy button', () => {
    Object.assign(query, { authError: 'apple_email_unavailable', diagnosticId });
    render(<AppleAuthError />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'auth:socialAuth.appleError.emailUnavailable'
    );
    expect(screen.queryByText(diagnosticId)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render arbitrary query parameters as errors or reference values', () => {
    Object.assign(query, { authError: 'untrusted-error', diagnosticId: 'secret-token' });
    const { rerender } = render(<AppleAuthError />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    query.authError = 'apple_signin_failed';
    rerender(<AppleAuthError />);
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retries Apple sign-in with the complete mobile destination and fresh OAuth state', () => {
    const redirect =
      '/auth/mobile?code_challenge=c&state=s&redirect_uri=teable%3A%2F%2Fauth%2Fcallback';
    Object.assign(query, { authError: 'apple_signin_failed', diagnosticId, redirect });
    render(<SocialAuth />);
    fireEvent.click(screen.getByRole('button', { name: 'auth:socialAuth.appleError.retry' }));
    const url = new URL(window.location.href);
    expect(url.pathname).toBe('/api/auth/apple');
    expect(url.searchParams.get('redirect_uri')).toBe(redirect);
    expect(url.searchParams.has('diagnosticId')).toBe(false);
    expect(url.searchParams.has('state')).toBe(false);
  });
});
