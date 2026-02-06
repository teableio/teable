import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import type { IButtonConfig } from './IllustrationPage';
import { IllustrationPage } from './IllustrationPage';

type ForbiddenPageProps = {
  title?: string;
  description?: string;
  button?: IButtonConfig;
};

export const ForbiddenPage: FC<ForbiddenPageProps> = ({ title, description, button }) => {
  const { t } = useTranslation('common');

  return (
    <IllustrationPage
      imageLightSrc="/images/layout/permission-light.png"
      imageDarkSrc="/images/layout/permission-dark.png"
      imageAlt="Permission Denied"
      title={title ?? t('system.forbidden.title')}
      description={description ?? t('system.forbidden.description')}
      button={button ?? { label: t('system.links.backToHome'), href: '/' }}
    />
  );
};
