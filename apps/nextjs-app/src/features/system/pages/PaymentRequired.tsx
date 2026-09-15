import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useUpgradeCtaEnabled } from '@/features/app/hooks/useUpgradeCtaEnabled';
import type { IButtonConfig } from './IllustrationPage';
import { IllustrationPage } from './IllustrationPage';

type PaymentRequiredPageProps = {
  title?: string;
  description?: string;
  button?: IButtonConfig;
};

export const PaymentRequiredPage: FC<PaymentRequiredPageProps> = ({
  title,
  description,
  button,
}) => {
  const { t } = useTranslation('common');
  const upgradeCtaEnabled = useUpgradeCtaEnabled();
  // Native mobile WebView: name the constraint, no upgrade pitch (App Store 3.1.3).
  const defaultTitle = upgradeCtaEnabled
    ? t('system.paymentRequired.title')
    : t('mobileEmbed.featureUnavailableTitle');
  const defaultDescription = upgradeCtaEnabled
    ? t('system.paymentRequired.description')
    : t('billing.unavailableInPlanTips');

  return (
    <IllustrationPage
      imageLightSrc="/images/layout/upgrade-light.png"
      imageDarkSrc="/images/layout/upgrade-dark.png"
      imageAlt="Payment Required"
      // The backend's 402 localizations pitch an upgrade: not inside the native WebView.
      title={upgradeCtaEnabled ? title ?? defaultTitle : defaultTitle}
      description={upgradeCtaEnabled ? description ?? defaultDescription : defaultDescription}
      button={button ?? { label: t('system.links.backToHome'), href: '/' }}
    />
  );
};
