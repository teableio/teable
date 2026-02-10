import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import type { IButtonConfig } from './IllustrationPage';
import { IllustrationPage } from './IllustrationPage';

type NotFoundPageProps = {
  title?: string;
  description?: string;
  button?: IButtonConfig;
};

export const NotFoundPage: FC<NotFoundPageProps> = ({ title, description, button }) => {
  const { t } = useTranslation('common');

  return (
    <IllustrationPage
      imageLightSrc="/images/layout/not-found-light.png"
      imageDarkSrc="/images/layout/not-found-dark.png"
      imageAlt="Not Found"
      title={title ?? t('system.notFound.title')}
      description={description ?? t('system.notFound.description')}
      button={button ?? { label: t('system.links.backToHome'), href: '/' }}
    />
  );
};
