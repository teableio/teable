import { HelpCircle } from '@teable/icons';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useInitializationZodI18n } from '@/features/app/hooks/useInitializationZodI18n';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import { SettingRight } from '../SettingRight';
import { SettingRightTitle } from '../SettingRightTitle';
import { OAuthAppList } from './manage/List';
import { OAuthAppEdit } from './manage/OAuthAppEdit';
import { OAuthAppNew } from './manage/OAuthAppNew';

export type IFormType = 'new' | 'edit';

export const OAuthAppPage = () => {
  const router = useRouter();
  const formType = router.query.form as IFormType;
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  useInitializationZodI18n();

  const onBack = () => {
    router.push({ pathname: router.pathname });
  };

  const title = useMemo(() => {
    switch (formType) {
      case 'new':
        return t('oauth:title.add');
      case 'edit':
        return t('oauth:title.edit');
      default:
        return t('setting:oauthApps');
    }
  }, [formType, t]);

  const FormPage = useMemo(() => {
    const onBack = () => {
      router.push({ pathname: router.pathname });
    };
    switch (formType) {
      case 'new':
        return <OAuthAppNew onBack={onBack} />;
      case 'edit':
        return <OAuthAppEdit onBack={onBack} />;
      default:
        return <OAuthAppList />;
    }
  }, [formType, router]);

  return (
    <SettingRight
      title={
        <SettingRightTitle
          title={
            <div className="flex items-center gap-x-4">
              <div>{title}</div>
              <Link
                href={t('oauth:help.link')}
                target="_blank"
                className="flex items-center gap-x-1 text-sm font-normal text-gray-500 hover:underline"
              >
                {t('oauth:help.title')}
                <HelpCircle className="size-4" />
              </Link>
            </div>
          }
          onBack={formType ? onBack : undefined}
        />
      }
    >
      <div className="my-3 space-y-1">{FormPage}</div>
    </SettingRight>
  );
};
