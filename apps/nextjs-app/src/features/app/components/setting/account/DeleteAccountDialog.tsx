import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import type { IDeleteUserErrorData } from '@teable/openapi';
import { deleteUser, deleteUserErrorDataSchema } from '@teable/openapi';
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
} from '@teable/ui-lib/shadcn';
import { Alert, AlertDescription } from '@teable/ui-lib/shadcn/ui/alert';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

export const DeleteAccountDialog = () => {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<IDeleteUserErrorData | string | null>(null);

  const { mutate: deleteAccountMutation, isLoading } = useMutation({
    mutationFn: (confirm: string) => deleteUser(confirm),
    meta: {
      preventGlobalError: true,
    },
    onError: (error: HttpError) => {
      if (
        error.code === HttpErrorCode.VALIDATION_ERROR &&
        error.data &&
        deleteUserErrorDataSchema.safeParse(error.data).success
      ) {
        setDeleteError(error.data as IDeleteUserErrorData);
      } else {
        setDeleteError(error.message);
      }
    },
    onSuccess: () => {
      window.location.reload();
    },
  });

  const handleDelete = () => {
    deleteAccountMutation(confirmText);
  };

  useEffect(() => {
    setConfirmText('');
    setDeleteError(null);
  }, [open, setConfirmText]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size={'sm'}>
          {t('settings.account.deleteAccount.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-5 text-destructive" />
            {t('settings.account.deleteAccount.title')}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {t('settings.account.deleteAccount.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {typeof deleteError === 'string' && (
            <Alert variant="destructive">
              <X className="size-4" />
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          {deleteError &&
            typeof deleteError === 'object' &&
            Object.keys(deleteError).map((key) => {
              const errorKey = key as keyof IDeleteUserErrorData;
              const error = deleteError[errorKey];
              return (
                <Alert variant="destructive" key={key}>
                  <X className="size-4" />
                  <AlertDescription className="text-[13px]">
                    <strong>{t('settings.account.deleteAccount.error.title')}</strong>
                    <p className="mt-1">{t('settings.account.deleteAccount.error.desc')}</p>
                    <ul className="ml-4 mt-2 flex list-disc flex-col gap-2">
                      {error.map((item, index) => (
                        <li key={index}>
                          <Button variant="secondary" asChild size="xs">
                            <Link
                              href={item.deletedTime ? `/space/trash` : `/space/${item.id}`}
                              target="_blank"
                            >
                              {item.name}
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2">
                      {t(`settings.account.deleteAccount.error.${errorKey}Error`)}
                    </p>
                  </AlertDescription>
                </Alert>
              );
            })}
          <div className="space-y-2">
            <Label htmlFor="confirm" className="text-[13px]">
              <Trans
                ns="common"
                i18nKey="settings.account.deleteAccount.confirm.title"
                components={{ code: <code className="text-destructive" /> }}
              />
            </Label>
            <Input
              id="confirm"
              className="h-8 text-[13px]"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t('settings.account.deleteAccount.confirm.placeholder')}
              disabled={isLoading}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isLoading}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={confirmText !== 'DELETE'}
          >
            {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isLoading ? t('settings.account.deleteAccount.loading') : t('common:actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
