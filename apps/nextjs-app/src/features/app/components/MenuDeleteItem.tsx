import { Trash2 } from '@teable/icons';
import { Button, DropdownMenuItem, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';

interface IMenuDeleteItemProps {
  children?: React.ReactNode | React.ReactNode[];
  onConfirm?: () => void;
  text?: {
    confirmButton?: string;
    cancelButton?: string;
  };
  disabled?: boolean;
}

export const MenuDeleteItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuItem>,
  IMenuDeleteItemProps
>((props, ref) => {
  const [deleteAlter, setDeleteAlter] = useState(false);
  const { onConfirm, children, text, disabled = false } = props;
  const { t } = useTranslation('common');

  const { confirmButton = t('actions.yesDelete'), cancelButton = t('actions.cancel') } = text ?? {};
  return (
    <div className="relative overflow-hidden">
      <DropdownMenuItem
        ref={ref}
        disabled={disabled}
        className="text-destructive focus:bg-destructive/20 focus:text-destructive dark:focus:bg-destructive dark:focus:text-foreground"
        onClick={(e) => {
          setDeleteAlter(true);
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children ?? (
          <>
            <Trash2 className="mr-1.5" />
            {t('actions.delete')}
          </>
        )}
      </DropdownMenuItem>
      <div
        className={cn(
          'absolute size-full flex bottom-0 items-center gap-1 justify-between bg-background translate-y-full transition-transform',
          {
            'translate-y-0': deleteAlter,
          }
        )}
      >
        <Button
          className="flex-1 px-1.5"
          variant={'destructive'}
          size={'xs'}
          onClick={(e) => {
            e.stopPropagation();
            onConfirm?.();
          }}
        >
          {confirmButton}
        </Button>
        <Button
          className="flex-1 px-1.5"
          variant={'outline'}
          size={'xs'}
          onClick={(e) => {
            e.stopPropagation();
            setDeleteAlter(false);
          }}
        >
          {cancelButton}
        </Button>
      </div>
    </div>
  );
});

MenuDeleteItem.displayName = 'MenuDeleteItem';
