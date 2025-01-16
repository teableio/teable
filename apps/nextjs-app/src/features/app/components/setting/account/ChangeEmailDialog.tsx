import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import { Check } from '@teable/icons';
import type { ISendChangeEmailCodeRo } from '@teable/openapi';
import { changeEmail, sendChangeEmailCode } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Error as ErrorComponent, Spin } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

export function ChangeEmailDialog({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sendSuccess, setSendSuccess] = useState(false);
  const [token, setToken] = useState('');
  const { user } = useSession();
  const router = useRouter();

  useEffect(() => {
    setError('');
  }, [currentPassword, newEmail, code]);

  const { mutate: sendChangeEmailCodeMutation, isLoading: sendChangeEmailCodeLoading } =
    useMutation({
      mutationFn: (ro: ISendChangeEmailCodeRo) => {
        if (ro.email === user.email) {
          throw new Error(t('settings.account.changeEmail.error.invalidSameEmail'));
        }
        return sendChangeEmailCode(ro);
      },
      onSuccess: (data) => {
        setToken(data.data.token);
        setSendSuccess(true);
        setTimeout(() => {
          setSendSuccess(false);
        }, 2000);
        toast.success(t('settings.account.changeEmail.success.sendSuccess'));
      },
      meta: {
        preventGlobalError: true,
      },
      onError: (error: HttpError) => {
        if (error.code === HttpErrorCode.CONFLICT) {
          setError(t('settings.account.changeEmail.error.invalidConflict'));
        } else if (error.code === HttpErrorCode.INVALID_CREDENTIALS) {
          setError(t('settings.account.changeEmail.error.invalidPassword'));
        } else {
          setError(error.message);
        }
      },
    });

  const {
    mutate: changeEmailMutation,
    isLoading: changeEmailLoading,
    isSuccess,
  } = useMutation({
    mutationFn: changeEmail,
    onSuccess: () => {
      toast.success(t('settings.account.changeEmail.success.title'), {
        description: t('settings.account.changeEmail.success.desc'),
      });
      setTimeout(() => {
        router.reload();
      }, 2000);
    },
    meta: {
      preventGlobalError: true,
    },
    onError: (error: HttpError) => {
      if (error.code === HttpErrorCode.INVALID_CAPTCHA) {
        setError(t('settings.account.changeEmail.error.invalidCode'));
      } else {
        setError(error.message);
      }
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="md:w-80">
        <DialogHeader>
          <DialogTitle className="text-center text-sm">
            {t('settings.account.changeEmail.title')}
          </DialogTitle>
          <DialogDescription className="text-center text-xs">
            {t('settings.account.changeEmail.desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" htmlFor="currentPassword">
              {t('settings.account.changeEmail.current')}
            </Label>
            <Input
              className="h-7"
              id="currentPassword"
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              aria-autocomplete="inline"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" htmlFor="newEmail">
              {t('settings.account.changeEmail.new')}
            </Label>
            <Input
              className="h-7"
              id="newEmail"
              autoComplete="new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground" htmlFor="code">
                {t('settings.account.changeEmail.code')}
              </Label>
              <Button
                size={'sm'}
                variant={'outline'}
                onClick={() =>
                  !sendSuccess &&
                  sendChangeEmailCodeMutation({ email: newEmail, password: currentPassword })
                }
                disabled={sendChangeEmailCodeLoading || !newEmail || !currentPassword}
              >
                {sendChangeEmailCodeLoading && <Spin className="size-4" />}
                {sendSuccess && <Check className="size-4 text-green-500 dark:text-green-400" />}
                {t('settings.account.changeEmail.getCode')}
              </Button>
            </div>
            <Input
              className="h-7"
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        </div>
        <ErrorComponent className="break-all text-center" error={error} />
        <Button
          className="w-full"
          size={'sm'}
          onClick={() => changeEmailMutation({ email: newEmail, token, code })}
          disabled={changeEmailLoading || isSuccess}
        >
          {changeEmailLoading && <Spin className="size-4" />}
          {t('actions.confirm')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
