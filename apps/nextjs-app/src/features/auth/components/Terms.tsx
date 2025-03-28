import Link from 'next/link';
import { Trans, useTranslation } from 'next-i18next';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { authConfig } from '@/features/i18n/auth.config';

export const Terms = () => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const isCloud = useIsCloud();

  if (!isCloud) {
    return null;
  }

  return (
    <p className="mt-4 text-xs text-muted-foreground">
      <Trans
        ns="auth"
        i18nKey="legal.tip"
        components={{
          Terms: <Link className="underline" href={t('auth:legal.termsUrl')} target="_blank" />,
          Privacy: <Link className="underline" href={t('auth:legal.privacyUrl')} target="_blank" />,
        }}
      />
    </p>
  );
};
