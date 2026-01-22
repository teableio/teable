import { ArrowUpRight, Plus } from '@teable/icons';
import type { CreateAccessTokenVo, UpdateAccessTokenVo } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef } from 'react';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { SettingRight } from '../SettingRight';
import { SettingRightTitle } from '../SettingRightTitle';
import { AccessTokenList } from './AccessTokenList';
import type { IFormType } from './form/AccessTokenForm';
import { PersonAccessTokenForm } from './PersonAccessTokenForm';

export const PersonAccessTokenPage = () => {
  const router = useRouter();
  const accessTokenId = router.query.id as string;
  const formType = router.query.form as IFormType;
  const newTokenRef = useRef<string>();
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);

  const backList = () => {
    newTokenRef.current = undefined;
    router.push({ pathname: router.pathname });
  };

  const onSubmit = (params: CreateAccessTokenVo | UpdateAccessTokenVo) => {
    if (formType === 'new') {
      newTokenRef.current = (params as CreateAccessTokenVo).token;
    }
    router.push({ pathname: router.pathname });
  };

  const onRefresh = (token: string) => {
    newTokenRef.current = token;
    router.push({ pathname: router.pathname });
  };

  useEffect(() => {
    if (router.query) {
      newTokenRef.current = undefined;
    }
  }, [router.query]);

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
    <SettingRight
      contentClassName="py-0"
      header={
        <SettingRightTitle
          title={title}
          onBack={formType ? backList : undefined}
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
          className="h-auto items-center gap-x-2"
          titleClassName="text-lg font-medium"
        />
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
              {t('token:new.button')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex-1 py-4">
        {formType ? (
          <PersonAccessTokenForm
            accessTokenId={accessTokenId}
            onSubmit={onSubmit}
            onRefresh={onRefresh}
            onCancel={backList}
          />
        ) : (
          <AccessTokenList
            newToken={newTokenRef.current}
            onEdit={(id) =>
              router.push({
                pathname: router.pathname,
                query: { form: 'edit', id },
              })
            }
          />
        )}
      </div>
    </SettingRight>
  );
};
