import { AlertCircle } from '@teable/icons';
import { APP_SIGNUP_UNAVAILABLE_AUTH_ERROR } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { authConfig } from '@/features/i18n/auth.config';

const APPLE_TITLE = 'auth:socialAuth.appleError.title';

/** `?authError=` codes a failed browser sign-in comes back with, and what the page says. */
const messages = {
  apple_email_unavailable: {
    title: APPLE_TITLE,
    body: 'auth:socialAuth.appleError.emailUnavailable',
  },
  apple_account_unavailable: {
    title: APPLE_TITLE,
    body: 'auth:socialAuth.appleError.accountUnavailable',
  },
  apple_signin_failed: { title: APPLE_TITLE, body: 'auth:socialAuth.appleError.failed' },
  apple_session_expired: { title: APPLE_TITLE, body: 'auth:socialAuth.appleError.sessionExpired' },
  // Any provider: an iOS app sign-in that reached no existing account (none is created there).
  [APP_SIGNUP_UNAVAILABLE_AUTH_ERROR]: {
    title: 'auth:socialAuth.appSignup.title',
    body: 'auth:socialAuth.appSignup.description',
  },
} as const;

export const AppleAuthError = () => {
  const { query } = useRouter();
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const error = query.authError;
  if (typeof error !== 'string' || !Object.hasOwn(messages, error)) {
    return null;
  }
  const message = messages[error as keyof typeof messages];

  return (
    <div role="alert" className="my-4 space-y-2 border-s-2 border-destructive ps-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="size-4 shrink-0" />
        {t(message.title)}
      </p>
      <p className="break-words text-muted-foreground">{t(message.body)}</p>
    </div>
  );
};
