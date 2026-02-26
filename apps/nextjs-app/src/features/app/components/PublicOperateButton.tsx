import { useIsAnonymous, useIsHydrated, useShareId, useTemplate } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useRef } from 'react';
import { useShareAllowSave } from '../context/ShareContext';
import { useIsInIframe } from '../hooks/useIsInIframe';
import type { IShareSelectSpaceDialogRef } from './ShareSelectSpaceDialog';
import { ShareSelectSpaceDialog } from './ShareSelectSpaceDialog';
import type { ITemplateSelectSpaceDialogRef } from './TemplateSelectSpaceDialog';
import { TemplateSelectSpaceDialog } from './TemplateSelectSpaceDialog';

export const PublicOperateButton = () => {
  const isAnonymous = useIsAnonymous();
  const template = useTemplate();
  const shareId = useShareId();
  const isTemplate = !!template;
  const isShare = !!shareId;
  const allowSave = useShareAllowSave();
  const { t } = useTranslation(['common']);
  const router = useRouter();
  const isInIframe = useIsInIframe();
  const templateRef = useRef<ITemplateSelectSpaceDialogRef>(null);
  const shareRef = useRef<IShareSelectSpaceDialogRef>(null);
  const isHydrated = useIsHydrated();

  if (isInIframe || !isHydrated) {
    return <></>;
  }

  // For share mode, show "Copy to my space" button if allowSave is enabled
  if (isShare) {
    // Don't show the button if allowSave is disabled
    if (!allowSave) {
      return null;
    }

    const handleClick = () => {
      if (isAnonymous) {
        // Redirect to login first, then come back with isCopyToSpace flag
        const url = new URL(window.location.href);
        url.searchParams.set('isCopyToSpace', '1');
        router.push(`/auth/login?redirect=${encodeURIComponent(url.toString())}`);
        return;
      }
      shareRef.current?.setOpen(true);
    };

    return (
      <>
        <Button size={'sm'} className="w-full text-[13px] font-normal" onClick={handleClick}>
          {t('common:actions.copyToMySpace')}
        </Button>
        <ShareSelectSpaceDialog ref={shareRef} />
      </>
    );
  }

  if (!isAnonymous && !isTemplate) {
    return null;
  }

  const handleClick = () => {
    if (isTemplate) {
      if (isAnonymous) {
        const url = new URL(window.location.href);
        url.searchParams.set('isUseTemplate', '1');
        router.push(`/auth/login?redirect=${encodeURIComponent(url.toString())}`);
        return;
      }
      templateRef.current?.setOpen(true);
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
        <TemplateSelectSpaceDialog ref={templateRef} templateId={template.id} />
      )}
    </>
  );
};
