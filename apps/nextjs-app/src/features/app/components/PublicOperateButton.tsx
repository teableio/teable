import { useIsAnonymous, useIsHydrated, useTemplate } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useRef } from 'react';
import { useIsInIframe } from '../hooks/useIsInIframe';
import type { ITemplateSelectSpaceDialogRef } from './TemplateSelectSpaceDialog';
import { TemplateSelectSpaceDialog } from './TemplateSelectSpaceDialog';

export const PublicOperateButton = () => {
  const isAnonymous = useIsAnonymous();
  const template = useTemplate();
  const isTemplate = !!template;
  const { t } = useTranslation(['common']);
  const router = useRouter();
  const isInIframe = useIsInIframe();
  const ref = useRef<ITemplateSelectSpaceDialogRef>(null);
  const isHydrated = useIsHydrated();

  if (isInIframe || !isHydrated) {
    return <></>;
  }

  if (!isAnonymous && !isTemplate) {
    return;
  }

  const handleClick = () => {
    if (isTemplate) {
      if (isAnonymous) {
        const url = new URL(window.location.href);
        url.searchParams.set('isUseTemplate', '1');
        router.push(`/auth/login?redirect=${encodeURIComponent(url.toString())}`);
        return;
      }
      ref.current?.setOpen(true);
      return;
    }
    if (isAnonymous) {
      router.push(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`);
    }
  };

  return (
    <>
      <Button size={'sm'} className="w-full text-[13px] font-normal" onClick={handleClick}>
        {isTemplate ? t('common:actions.useTemplate') : t('common:actions.login')}
      </Button>
      {isTemplate && !isAnonymous && (
        <TemplateSelectSpaceDialog ref={ref} templateId={template.id} />
      )}
    </>
  );
};
