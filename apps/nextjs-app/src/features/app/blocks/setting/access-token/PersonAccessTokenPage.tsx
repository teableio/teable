import type { CreateAccessTokenVo, UpdateAccessTokenVo } from '@teable/openapi';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef } from 'react';
import { SettingRight } from '../SettingRight';
import { AccessTokenList } from './AccessTokenList';
import type { IFormType } from './form/AccessTokenForm';
import { PersonAccessTokenForm } from './PersonAccessTokenForm';
import { PersonAccessTokenTitle } from './PersonAccessTokenTitle';

export const PersonAccessTokenPage = () => {
  const router = useRouter();
  const formType = router.query.form as IFormType;
  const newTokenRef = useRef<string>();
  const { t } = useTranslation('common');

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

  return (
    <SettingRight
      title={<PersonAccessTokenTitle backList={backList} />}
      helpLink={t('help.apiLink')}
    >
      <div className="my-3 space-y-1">
        {formType ? (
          <PersonAccessTokenForm onSubmit={onSubmit} onRefresh={onRefresh} onCancel={backList} />
        ) : (
          <AccessTokenList newToken={newTokenRef.current} />
        )}
      </div>
    </SettingRight>
  );
};
