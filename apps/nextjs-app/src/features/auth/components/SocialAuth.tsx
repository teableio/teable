import { GithubLogo, GoogleLogo } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { authConfig } from '@/features/i18n/auth.config';

export const providersAll = [
  {
    id: 'github',
    text: 'Github',
    Icon: GithubLogo,
    authUrl: '/api/auth/github',
  },
  {
    id: 'google',
    text: 'Google',
    Icon: GoogleLogo,
    authUrl: '/api/auth/google',
  },
  {
    id: 'oidc',
    text: 'OIDC',
    authUrl: '/api/auth/oidc',
  },
];

export const SocialAuth = () => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const { socialAuthProviders, passwordLoginDisabled } = useEnv();
  const router = useRouter();
  const redirect = router.query.redirect as string;

  const providers = useMemo(
    () => providersAll.filter((provider) => socialAuthProviders?.includes(provider.id)),
    [socialAuthProviders]
  );

  const onClick = (authUrl: string) => {
    window.location.href = redirect
      ? `${authUrl}?redirect_uri=${encodeURIComponent(redirect)}`
      : authUrl;
  };

  if (!providers.length) {
    return;
  }

  return (
    <>
      {!passwordLoginDisabled && (
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t('auth:socialAuth.title')}
            </span>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {providers.map(({ id, text, Icon, authUrl }) => (
          <Button key={id} className="w-full" variant="outline" onClick={() => onClick(authUrl)}>
            {Icon && <Icon className="size-4" />}
            {text}
          </Button>
        ))}
      </div>
    </>
  );
};
