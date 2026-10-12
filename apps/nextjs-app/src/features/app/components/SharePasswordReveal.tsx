import { generateSharePassword, sharePasswordSchema } from '@teable/core';
import { Check, Edit, RefreshCcw, X } from '@teable/icons';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useBrand } from '@/features/app/hooks/useBrand';
import { CopyButton } from './CopyButton';

const WithTooltip = ({ content, children }: { content: string; children: ReactNode }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

// sm matches the smaller link row of the artifact share popover
const sizeStyles = {
  default: {
    button: { variant: 'outline', size: 'icon-sm', className: 'shrink-0' },
    icon: undefined,
    row: 'flex items-center gap-2',
  },
  sm: {
    button: { variant: 'ghost', size: 'xs' },
    icon: 'size-3.5',
    row: 'flex items-center gap-1',
  },
} as const;

interface ISharePasswordRevealProps {
  shareUrl?: string;
  password?: string;
  size?: keyof typeof sizeStyles;
  onSave: (password: string) => void;
}

// The stored password can't be read back, so it is only shown right after it was set in this panel
export const SharePasswordReveal = ({
  shareUrl,
  password,
  size = 'default',
  onSave,
}: ISharePasswordRevealProps) => {
  const { t } = useTranslation(['common']);
  const { brandName } = useBrand();
  // undefined while not editing
  const [draft, setDraft] = useState<string>();

  const { button: buttonProps, icon: iconClassName, row: rowClassName } = sizeStyles[size];

  if (draft !== undefined) {
    const isValid = sharePasswordSchema.safeParse(draft).success;
    return (
      <form
        className={rowClassName}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isValid) return;
          onSave(draft);
          setDraft(undefined);
        }}
      >
        <Input
          size={size}
          className="min-w-0 flex-1 font-mono"
          value={draft}
          placeholder={t('common:baseShare.enterPassword')}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
        />
        <WithTooltip content={t('common:baseShare.generatePassword')}>
          <Button {...buttonProps} type="button" onClick={() => setDraft(generateSharePassword())}>
            <RefreshCcw className={iconClassName} />
          </Button>
        </WithTooltip>
        <WithTooltip content={t('common:actions.confirm')}>
          <Button {...buttonProps} type="submit" disabled={!isValid}>
            <Check className={iconClassName} />
          </Button>
        </WithTooltip>
        <WithTooltip content={t('common:actions.cancel')}>
          <Button {...buttonProps} type="button" onClick={() => setDraft(undefined)}>
            <X className={iconClassName} />
          </Button>
        </WithTooltip>
      </form>
    );
  }

  return (
    <div className={rowClassName}>
      <Input
        size={size}
        className="min-w-0 flex-1 font-mono"
        value={password ?? '••••••••'}
        readOnly
      />
      {password && (
        <WithTooltip content={t('common:baseShare.copyLinkAndPassword')}>
          <CopyButton
            {...buttonProps}
            text={t('common:baseShare.linkAndPasswordText', {
              brand: brandName,
              url: shareUrl,
              password,
            })}
            iconClassName={iconClassName}
            disabled={!shareUrl}
          />
        </WithTooltip>
      )}
      <WithTooltip content={t('common:baseShare.passwordTitle')}>
        <Button {...buttonProps} onClick={() => setDraft('')}>
          <Edit className={iconClassName} />
        </Button>
      </WithTooltip>
    </div>
  );
};
