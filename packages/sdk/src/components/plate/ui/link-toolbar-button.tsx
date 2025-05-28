'use client';

import { Link } from '@teable/icons';
import { useLinkToolbarButton, useLinkToolbarButtonState } from '@udecode/plate-link/react';
import * as React from 'react';

import { useTranslation } from '../../../context/app/i18n';
import { ToolbarButton } from './toolbar';

export function LinkToolbarButton(props: React.ComponentProps<typeof ToolbarButton>) {
  const state = useLinkToolbarButtonState();
  const { props: buttonProps } = useLinkToolbarButton(state);

  const { t } = useTranslation();

  return (
    <ToolbarButton
      {...props}
      {...buttonProps}
      data-plate-focus
      tooltip={t('comment.toolbar.link')}
      size={'xs'}
    >
      <Link className="size-3.5" />
    </ToolbarButton>
  );
}
