import { ChevronLeft, Plus } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { Trans, useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { OAuthAppList } from '@/features/app/blocks/setting/oauth-app/manage/List';
import { OAuthAppEdit } from '@/features/app/blocks/setting/oauth-app/manage/OAuthAppEdit';
import { OAuthAppNew } from '@/features/app/blocks/setting/oauth-app/manage/OAuthAppNew';
import { useInitializationZodI18n } from '@/features/app/hooks/useInitializationZodI18n';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import { SettingTabHeader, SettingTabShell } from '../SettingTabShell';

type IFormType = 'new' | 'edit';

interface IViewState {
  formType?: IFormType;
  clientId?: string;
}

export const OAuthAppSection = () => {
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const [viewState, setViewState] = useState<IViewState>({});

  useInitializationZodI18n();

  const { formType, clientId } = viewState;

  const onBack = () => {
    setViewState({});
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

  return (
    <SettingTabShell
      header={
        <SettingTabHeader
          leading={
            formType ? (
              <Button variant="ghost" size="xs" onClick={onBack}>
                <ChevronLeft className="size-4" />
              </Button>
            ) : undefined
          }
          title={title}
          description={
            !formType ? (
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
            ) : undefined
          }
          actions={
            !formType ? (
              <Button size="xs" onClick={() => setViewState({ formType: 'new' })}>
                <Plus />
                {t('oauth:add')}
              </Button>
            ) : undefined
          }
        />
      }
    >
      <div className="flex-1">
        {formType === 'new' && <OAuthAppNew onBack={onBack} />}
        {formType === 'edit' && clientId && <OAuthAppEdit clientId={clientId} onBack={onBack} />}
        {!formType && (
          <OAuthAppList onEdit={(id) => setViewState({ formType: 'edit', clientId: id })} />
        )}
      </div>
    </SettingTabShell>
  );
};
