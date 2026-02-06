import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
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

  return (
    <IllustrationPage
      imageLightSrc="/images/layout/upgrade-light.png"
      imageDarkSrc="/images/layout/upgrade-dark.png"
      imageAlt="Payment Required"
      title={title ?? t('system.paymentRequired.title')}
      description={description ?? t('system.paymentRequired.description')}
      button={button ?? { label: t('system.links.backToHome'), href: '/' }}
    />
  );
};
