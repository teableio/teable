import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useInitializationZodI18n } from '@/features/app/hooks/useInitializationZodI18n';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';
import { SettingRight } from '../SettingRight';
import { SettingRightTitle } from '../SettingRightTitle';
import { PluginEdit } from './PluginEdit';
import { PluginList } from './PluginList';
import { PluginNew } from './PluginNew';

export type IFormType = 'new' | 'edit';

export const PluginPage = () => {
  const router = useRouter();
  const [createdSecret, setCreatedSecret] = useState<string>();
  const formType = router.query.form as IFormType;
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  useInitializationZodI18n();

  const onBack = () => {
    router.push({ pathname: router.pathname });
  };

  useEffect(() => {
    const handleRouteChange = (path: string) => {
      if (router.query.form !== 'new' || !path.startsWith('/setting/plugin?form=edit')) {
        setCreatedSecret(undefined);
      }
    };

    router.events.on('routeChangeStart', handleRouteChange);

    return () => {
      router.events.off('routeChangeStart', handleRouteChange);
    };
  }, [router]);

  const title = useMemo(() => {
    switch (formType) {
      case 'new':
        return t('plugin:title.add');
      case 'edit':
        return t('plugin:title.edit');
      default:
        return t('setting:plugins');
    }
  }, [formType, t]);

  const FormPage = useMemo(() => {
    switch (formType) {
      case 'new':
        return <PluginNew onCreated={(secret) => setCreatedSecret(secret)} />;
      case 'edit':
        return <PluginEdit secret={createdSecret} />;
      default:
        return <PluginList />;
    }
  }, [formType, createdSecret]);

  return (
    <SettingRight
      title={<SettingRightTitle title={title} onBack={formType ? onBack : undefined} />}
    >
      <div className="my-3 space-y-1">{FormPage}</div>
    </SettingRight>
  );
};
