import { Check, Copy } from '@teable/icons';
import type { ButtonProps } from '@teable/ui-lib';
import { Button, cn } from '@teable/ui-lib';
import { useState } from 'react';
import { syncCopy } from '../../../utils';

interface ICopyButtonProps extends ButtonProps {
  text: string;
  className?: string;
  iconClassName?: string;
}
export const CopyButton = (props: ICopyButtonProps) => {
  const { text, className, iconClassName, ...rest } = props;
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
        <Check className={cn('text-teal-500 animate-in duration-500', iconClassName)} />
      ) : (
        <Copy className={iconClassName} />
      )}
    </Button>
  );
};
