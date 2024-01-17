import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable-group/core';
import { changePassword, changePasswordRoSchema } from '@teable-group/openapi';
import { Spin } from '@teable-group/ui-lib/base';
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
} from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { fromZodError } from 'zod-validation-error';

interface IChangePasswordDialogProps {
  children?: React.ReactNode;
}
export const ChangePasswordDialog = (props: IChangePasswordDialogProps) => {
  const { children } = props;
  const router = useRouter();
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');

  const { mutate: changePasswordMutate, isLoading } = useMutation(changePassword, {
    onSuccess: () => {
      toast({
        title: 'Change password successfully',
        description: 'You will be redirected to the login page in 2 seconds.',
      });
      setTimeout(() => {
        router.push('/auth/login', {
          query: { redirect: router.asPath },
        });
      }, 2000);
    },
    onError: (err: HttpError) => {
      setError(err.message);
    },
  });

  const checkConfirmEqual = () => {
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      setError('Your new password does not match.');
      return;
    }
    if (newPassword && confirmPassword && currentPassword === newPassword) {
      setError('Your new password must be different from your current password.');
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
      setError(fromZodError(valid.error).message);
      return;
    }
    changePasswordMutate({ password: currentPassword, newPassword });
  };

  return (
    <Dialog onOpenChange={reset}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="md:w-80">
        <DialogHeader>
          <DialogTitle className="text-center text-sm">Change Password</DialogTitle>
          <DialogDescription className="text-center text-xs">
            Please enter your current password and your new password.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" htmlFor="currentPassword">
              Enter your current password
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
              Enter a new password
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
              Confirm your new password
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
            disabled={disableSubmitBtn}
            onClick={handleSubmit}
          >
            {isLoading && <Spin className="mr-1 h-4 w-4" />}
            Change password
          </Button>
          <DialogClose asChild>
            <Button size={'sm'} className="w-full" variant={'ghost'}>
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
