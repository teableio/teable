import { Plus } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
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
  const clientId = router.query.id as string;
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

  const description = useMemo(() => {
    if (formType) {
      return undefined;
    }
    return (
      <Trans
        ns="oauth"
        i18nKey="title.description"
        components={{
          a: (
            <Link
              href={t('oauth:help.link')}
              className="text-violet-500 underline underline-offset-4"
              target="_blank"
            />
          ),
        }}
      />
    );
  }, [formType, t]);

  const FormPage = useMemo(() => {
    const onBack = () => {
      router.push({ pathname: router.pathname });
    };
    switch (formType) {
      case 'new':
        return <OAuthAppNew onBack={onBack} />;
      case 'edit':
        return <OAuthAppEdit clientId={clientId} onBack={onBack} />;
      default:
        return (
          <OAuthAppList
            onEdit={(id) =>
              router.push({
                pathname: router.pathname,
                query: { form: 'edit', id },
              })
            }
          />
        );
    }
  }, [formType, router, clientId]);

  return (
    <SettingRight
      header={
        <SettingRightTitle
          title={title}
          onBack={formType ? onBack : undefined}
          description={description}
          className="h-auto items-center gap-x-2"
          titleClassName="text-lg font-medium"
        />
      }
      actions={
        !formType ? (
          <Button
            size="xs"
            onClick={() =>
              router.push({
                pathname: router.pathname,
                query: { form: 'new' },
              })
            }
          >
            <Plus />
            {t('oauth:add')}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-1">{FormPage}</div>
    </SettingRight>
  );
};
