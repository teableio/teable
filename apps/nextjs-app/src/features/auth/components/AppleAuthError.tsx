import { AlertCircle } from '@teable/icons';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { authConfig } from '@/features/i18n/auth.config';

const messages = {
  apple_email_unavailable: 'auth:socialAuth.appleError.emailUnavailable',
  apple_account_unavailable: 'auth:socialAuth.appleError.accountUnavailable',
  apple_signin_failed: 'auth:socialAuth.appleError.failed',
  apple_session_expired: 'auth:socialAuth.appleError.sessionExpired',
} as const;

export const AppleAuthError = () => {
  const { query } = useRouter();
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const error = query.authError;
  if (typeof error !== 'string' || !Object.prototype.hasOwnProperty.call(messages, error)) {
    return null;
  }

  return (
    <div role="alert" className="my-4 space-y-2 border-s-2 border-destructive ps-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="size-4 shrink-0" />
        {t('auth:socialAuth.appleError.title')}
      </p>
      <p className="break-words text-muted-foreground">
        {t(messages[error as keyof typeof messages])}
      </p>
    </div>
  );
};
