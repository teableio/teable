import { ArrowUpRight, ChevronLeft, Plus } from '@teable/icons';
import type { CreateAccessTokenVo, UpdateAccessTokenVo } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { Trans, useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';
import { AccessTokenList } from '@/features/app/blocks/setting/access-token/AccessTokenList';
import type { IFormType } from '@/features/app/blocks/setting/access-token/form/AccessTokenForm';
import { PersonAccessTokenForm } from '@/features/app/blocks/setting/access-token/PersonAccessTokenForm';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { SettingTabHeader, SettingTabShell } from '../SettingTabShell';

interface IViewState {
  formType?: IFormType;
  accessTokenId?: string;
}

export const PersonalAccessTokenSection = () => {
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);
  const [viewState, setViewState] = useState<IViewState>({});
  const newTokenRef = useRef<string>();

  const { formType, accessTokenId = '' } = viewState;

  const onBack = () => {
    newTokenRef.current = undefined;
    setViewState({});
  };

  const onSubmit = (data: CreateAccessTokenVo | UpdateAccessTokenVo) => {
    if (formType === 'new' && 'token' in data) {
      newTokenRef.current = data.token;
    }
    setViewState({});
  };

  const onRefresh = (token: string) => {
    newTokenRef.current = token;
    setViewState({});
  };

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
                ns="token"
                i18nKey="list.description"
                components={{
                  a: (
                    <Link
                      href={t('token:help.link')}
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
              <>
                <Button size="xs" variant="ghost" asChild>
                  <Link href="/developer/tool/query-builder" target="_blank" className="gap-1">
                    <ArrowUpRight className="size-4" />
                    {t('developer:apiQueryBuilder')}
                  </Link>
                </Button>
                <Button size="xs" onClick={() => setViewState({ formType: 'new' })}>
                  <Plus />
                  {t('token:new.button')}
                </Button>
              </>
            ) : undefined
          }
        />
      }
      contentClassName="py-0"
    >
      <div className="flex-1 py-4">
        {formType ? (
          <PersonAccessTokenForm
            formType={formType}
            accessTokenId={accessTokenId}
            onSubmit={onSubmit}
            onRefresh={onRefresh}
            onCancel={onBack}
          />
        ) : (
          <AccessTokenList
            newToken={newTokenRef.current}
            onEdit={(id) => setViewState({ formType: 'edit', accessTokenId: id })}
          />
        )}
      </div>
    </SettingTabShell>
  );
};
