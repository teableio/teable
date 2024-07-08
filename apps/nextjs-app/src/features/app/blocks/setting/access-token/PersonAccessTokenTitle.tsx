import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { SettingRightTitle } from '../SettingRightTitle';
import type { IFormType } from './form/AccessTokenForm';

interface IPersonAccessTokenTitleProps {
  backList: () => void;
}

export const PersonAccessTokenTitle = (props: IPersonAccessTokenTitleProps) => {
  const { backList } = props;
  const router = useRouter();
  const formType = router.query.form as IFormType;
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);

  const title = useMemo(() => {
    switch (formType) {
      case 'new':
        return t('token:new.headerTitle');
      case 'edit':
        return t('token:edit.title');
      default:
        return t('setting:personalAccessToken');
    }
  }, [formType, t]);

  return <SettingRightTitle title={title} onBack={formType ? backList : undefined} />;
};
