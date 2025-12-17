import { useIsAnonymous, useTemplate } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useIsInIframe } from '../hooks/useIsInIframe';

export const PublicOperateButton = () => {
  const isAnonymous = useIsAnonymous();
  const template = useTemplate();
  const isTemplate = !!template;
  const { t } = useTranslation(['common']);
  const router = useRouter();
  const isInIframe = useIsInIframe();

  if (isInIframe) {
    return <></>;
  }

  if (!isAnonymous && !isTemplate) {
    return;
  }

  const handleClick = () => {
    if (isAnonymous) {
      router.push(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`);
      return;
    }
    if (isTemplate) {
      router.push('/template');
    }
    console.log('click');
  };

  return (
    <Button size={'sm'} className="w-full text-[13px] font-normal" onClick={handleClick}>
      {isAnonymous ? t('common:actions.login') : t('common:actions.useTemplate')}
    </Button>
  );
};
