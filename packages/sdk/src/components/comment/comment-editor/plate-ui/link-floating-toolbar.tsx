'use client';

import { Link, A } from '@teable/icons';
import { cn } from '@udecode/cn';
import { useFormInputProps, useEditorRef } from '@udecode/plate-common/react';
import { type UseVirtualFloatingOptions, flip, offset } from '@udecode/plate-floating';
import {
  FloatingLinkUrlInput,
  type LinkFloatingToolbarState,
  LinkOpenButton,
  useFloatingLinkEdit,
  useFloatingLinkEditState,
  useFloatingLinkInsert,
  useFloatingLinkInsertState,
} from '@udecode/plate-link/react';
import { cva } from 'class-variance-authority';
import { useTranslation } from '../../../../context/app/i18n';
import { buttonVariants } from './button';
import { Icons } from './icons';
import { inputVariants } from './input';
import { Separator } from './separator';

export const popoverVariants = cva(
  'w-72 rounded-md border border-slate-200 bg-white p-4 text-slate-950 shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50 print:hidden'
);

const floatingOptions: UseVirtualFloatingOptions = {
  middleware: [
    offset(12),
    flip({
      fallbackPlacements: ['bottom-end', 'top-start', 'top-end'],
      padding: 12,
    }),
  ],
  placement: 'bottom-start',
};

export interface LinkFloatingToolbarProps {
  state?: LinkFloatingToolbarState;
}

export function LinkFloatingToolbar({ state }: LinkFloatingToolbarProps) {
  const insertState = useFloatingLinkInsertState({
    ...state,
    floatingOptions: {
      ...floatingOptions,
      ...state?.floatingOptions,
    },
  });
  const {
    hidden,
    props: insertProps,
    ref: insertRef,
    textInputProps,
  } = useFloatingLinkInsert(insertState);
  const { t } = useTranslation();
  const editorRef = useEditorRef();
  const editState = useFloatingLinkEditState({
    ...state,
    floatingOptions: {
      ...floatingOptions,
      ...state?.floatingOptions,
    },
  });
  const {
    editButtonProps,
    props: editProps,
    ref: editRef,
    unlinkButtonProps,
  } = useFloatingLinkEdit(editState);
  const inputProps = useFormInputProps({
    preventDefaultOnEnterKeydown: true,
  });

  if (hidden) return null;

  const input = (
    <div className="flex w-[330px] flex-col" {...inputProps}>
      <div className="flex items-center">
        <div className="flex items-center pl-3 text-slate-500 dark:text-slate-400">
          <Link className="size-4" />
        </div>

        <FloatingLinkUrlInput
          className={inputVariants({ h: 'sm', variant: 'ghost' })}
          placeholder={t('comment.floatToolbar.enterUrl')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (editorRef as any)?.api?.floatingLink?.hide();
            }
            e.stopPropagation();
          }}
        />
      </div>
      <Separator />
      <div className="flex items-center">
        <div className="flex items-center pl-3 text-slate-500 dark:text-slate-400">
          <A className="size-4" />
        </div>
        <input
          className={inputVariants({ h: 'sm', variant: 'ghost' })}
          placeholder={t('comment.floatToolbar.linkText')}
          {...textInputProps}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (editorRef as any)?.api?.floatingLink?.hide();
              e.stopPropagation();
            }
          }}
        />
      </div>
    </div>
  );

  const editContent = editState.isEditing ? (
    input
  ) : (
    <div className="box-content flex h-9 items-center gap-1">
      <button
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
        type="button"
        {...editButtonProps}
      >
        {t('comment.floatToolbar.editLink')}
      </button>

      <Separator orientation="vertical" />

      <LinkOpenButton
        className={buttonVariants({
          size: 'sms',
          variant: 'ghost',
        })}
      >
        <Icons.externalLink width={18} />
      </LinkOpenButton>

      <Separator orientation="vertical" />

      <button
        className={buttonVariants({
          size: 'sms',
          variant: 'ghost',
        })}
        type="button"
        {...unlinkButtonProps}
      >
        <Icons.unlink width={18} />
      </button>
    </div>
  );

  return (
    <>
      <div className={cn(popoverVariants(), 'w-auto p-1')} ref={insertRef} {...insertProps}>
        {input}
      </div>

      <div className={cn(popoverVariants(), 'w-auto p-1')} ref={editRef} {...editProps}>
        {editContent}
      </div>
    </>
  );
}
