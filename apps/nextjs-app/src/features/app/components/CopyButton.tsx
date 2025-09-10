import { Check, Copy } from '@teable/icons';
import { syncCopy } from '@teable/sdk/utils';
import type { ButtonProps } from '@teable/ui-lib/shadcn';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useState } from 'react';

interface ICopyButtonProps extends ButtonProps {
  text: string;
  iconClassName?: string;
  className?: string;
  label?: string;
  labelClassName?: string;
}
export const CopyButton = (props: ICopyButtonProps) => {
  const { text, iconClassName, className, label, labelClassName, ...rest } = props;
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const onCopy = () => {
    syncCopy(text);
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  return (
    <Button {...rest} onClick={onCopy} className={className}>
      {isCopied ? (
        <Check
          className={cn(
            'text-green-400 dark:text-green-600 animate-bounce duration-500 repeat-1',
            iconClassName
          )}
        />
      ) : (
        <Copy className={iconClassName} />
      )}
      {label && <span className={cn('text-xs text-foreground', labelClassName)}>{label}</span>}
    </Button>
  );
};
