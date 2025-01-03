import { Check, Copy } from '@teable/icons';
import type { ButtonProps } from '@teable/ui-lib';
import { Button, cn } from '@teable/ui-lib';
import { useState } from 'react';

interface ICopyButtonProps extends ButtonProps {
  text: string;
  iconClassName?: string;
}
export const CopyButton = (props: ICopyButtonProps) => {
  const { text, iconClassName, ...rest } = props;
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const onCopy = () => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-999999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  return (
    <Button {...rest} onClick={onCopy}>
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
    </Button>
  );
};
