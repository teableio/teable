import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { changePassword, changePasswordRoSchema } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  useToast,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

interface IChangePasswordDialogProps {
  children?: React.ReactNode;
}
export const ChangePasswordDialog = (props: IChangePasswordDialogProps) => {
  const { children } = props;
  const { t } = useTranslation('common');
  const router = useRouter();
  const { user } = useSession();
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');

  const {
    mutate: changePasswordMutate,
    isLoading,
    isSuccess,
  } = useMutation(changePassword, {
    onSuccess: () => {
      toast({
        title: t('settings.account.changePasswordSuccess.title'),
        description: t('settings.account.changePasswordSuccess.desc'),
      });
      setTimeout(() => {
        router.reload();
      }, 2000);
    },
    onError: (err: HttpError) => {
      console.error(err.message);
      setError(t('settings.account.changePasswordError.invalid'));
    },
  });

  const checkConfirmEqual = () => {
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      setError(t('settings.account.changePasswordError.disMatch'));
      return;
    }
    if (newPassword && confirmPassword && currentPassword === newPassword) {
      setError(t('settings.account.changePasswordError.equal'));
      return;
    }
    setError('');
  };

  const reset = () => {
    setNewPassword('');
    setConfirmPassword('');
    setCurrentPassword('');
    setError('');
  };

  const disableSubmitBtn =
    !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword;

  const handleSubmit = async () => {
    const valid = changePasswordRoSchema.safeParse({ password: currentPassword, newPassword });
    if (!valid.success) {
      setError(t('password.setInvalid'));
      return;
    }
    changePasswordMutate({ password: currentPassword, newPassword });
  };

  return (
    <Dialog onOpenChange={reset}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="md:w-80">
        <DialogHeader>
          <DialogTitle className="text-center text-sm">
            {t('settings.account.changePassword.title')}
          </DialogTitle>
          <DialogDescription className="text-center text-xs">
            {t('settings.account.changePassword.desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Input
              className="visible m-0 h-0 border-0 p-0 text-[0]"
              type="text"
              name="email"
              autoComplete="email"
              readOnly
              value={user.email}
            />
            <Label className="text-xs text-muted-foreground" htmlFor="currentPassword">
              {t('settings.account.changePassword.current')}
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
            <Label className="text-xs text-muted-foreground" htmlFor="newPassword">
              {t('settings.account.changePassword.new')}
            </Label>
            <Input
              className="h-7"
              id="newPassword"
              autoComplete="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onBlur={checkConfirmEqual}
              aria-autocomplete="inline"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" htmlFor="confirmPassword">
              {t('settings.account.changePassword.confirm')}
            </Label>
            <Input
              className="h-7"
              id="confirmPassword"
              autoComplete="new-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={checkConfirmEqual}
              aria-autocomplete="inline"
            />
          </div>
          {error && <div className="text-center text-xs text-red-500">{error}</div>}
        </div>
        <DialogFooter className="flex-col space-y-2 sm:flex-col sm:space-x-0">
          <Button
            size={'sm'}
            className="w-full"
            type="submit"
            disabled={disableSubmitBtn || isSuccess || isLoading}
            onClick={handleSubmit}
          >
            {isLoading && <Spin className="mr-1 size-4" />}
            {t('settings.account.changePassword.title')}
          </Button>
          <DialogClose asChild>
            <Button size={'sm'} className="w-full" variant={'ghost'}>
              {t('actions.cancel')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
