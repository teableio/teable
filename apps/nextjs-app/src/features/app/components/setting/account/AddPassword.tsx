import { useMutation } from '@tanstack/react-query';
import { addPassword } from '@teable/openapi';
import { passwordSchema } from '@teable/openapi/src/auth/types';
import { useSession } from '@teable/sdk/hooks';
import { Error, Spin } from '@teable/ui-lib/base';
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
  useToast,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

export const AddPassword = () => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { t } = useTranslation('common');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { refresh } = useSession();

  const { mutateAsync: addPasswordMutate, isLoading } = useMutation({
    mutationFn: addPassword,
    onSuccess: () => {
      toast({ title: t('settings.account.addPasswordSuccess.title') });
      setOpen(false);
      refresh();
    },
  });

  useEffect(() => {
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      setError(t('settings.account.addPasswordError.disMatch'));
      return;
    }
    if (newPassword && confirmPassword && !passwordSchema.safeParse(newPassword).success) {
      setError(t('password.setInvalid'));
      return;
    }
    setError('');
  }, [newPassword, confirmPassword, t]);

  const handleSubmit = () => {
    if (error || !newPassword || !confirmPassword || isLoading) {
      return;
    }
    addPasswordMutate({ password: newPassword });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={'link'} className="text-xs text-blue-500 hover:text-blue-700">
          {t('settings.account.addPassword.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="md:w-80">
        <DialogHeader>
          <DialogTitle className="text-center text-sm">
            {t('settings.account.addPassword.title')}
          </DialogTitle>
          <DialogDescription className="text-center text-xs">
            {t('settings.account.addPassword.desc')}
          </DialogDescription>
        </DialogHeader>
        <div>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="newPassword">
                {t('settings.account.addPassword.password')}
              </Label>
              <Input
                className="h-7"
                id="newPassword"
                autoComplete="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-autocomplete="inline"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="confirmPassword">
                {t('settings.account.addPassword.confirm')}
              </Label>
              <Input
                className="h-7"
                id="confirmPassword"
                autoComplete="new-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-autocomplete="inline"
              />
            </div>
          </div>
          <Error error={error} />
        </div>
        <DialogFooter className="flex-col space-y-2 sm:flex-col sm:space-x-0">
          <Button size={'sm'} className="w-full" type="submit" onClick={handleSubmit}>
            {isLoading && <Spin className="mr-1 size-4" />}
            {t('settings.account.addPassword.title')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
