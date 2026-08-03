import { Check } from '@teable/icons';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { authConfig } from '@/features/i18n/auth.config';

interface SendVerificationButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled: boolean;
  loading?: boolean;
  countdown?: number;
}

export const SendVerificationButton = ({
  disabled,
  onClick,
  loading,
  countdown = 0,
}: SendVerificationButtonProps) => {
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const [isSuccess, setIsSuccess] = useState(false);
  const prevLoading = useRef(loading);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (!loading && prevLoading.current) {
      setIsSuccess(true);
      timer = setTimeout(() => {
        setIsSuccess(false);
      }, 3000);
    } else {
      setIsSuccess(false);
    }
    prevLoading.current = loading;
    return () => {
      timer && clearTimeout(timer);
      timer = null;
    };
  }, [loading]);

  const getButtonText = () => {
    if (countdown > 0) {
      return `${t('auth:button.resend')} (${countdown}s)`;
    }
    return t('auth:button.resend');
  };

  return (
    <Button
      variant={'outline'}
      className="mt-4 w-full"
      disabled={disabled}
      onClick={(e) => {
        if (isSuccess || countdown > 0) {
          return;
        }
        onClick(e);
      }}
    >
      {loading && <Spin />}
      {!loading && isSuccess && countdown === 0 && (
        <Check className="size-4 animate-bounce text-green-500 dark:text-green-400" />
      )}
      {getButtonText()}
    </Button>
  );
};
