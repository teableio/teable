import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@teable-group/ui-lib/shadcn';
import { useState } from 'react';

interface IChangePasswordDialogProps {
  children?: React.ReactNode;
}
export const ChangePasswordDialog = (props: IChangePasswordDialogProps) => {
  const { children } = props;
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');

  const checkConfirmEqual = () => {
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      setError('Your new password does not match.');
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
          <Button size={'sm'} className="w-full" type="submit">
            Change password
          </Button>
          <Button size={'sm'} className="w-full" variant={'ghost'}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
