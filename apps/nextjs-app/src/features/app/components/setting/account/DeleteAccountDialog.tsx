import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { HttpErrorCode, Role } from '@teable/core';
import type { IDeleteUserErrorData } from '@teable/openapi';
import { deleteUser, deleteUserErrorDataSchema, updateSpaceCollaborator } from '@teable/openapi';
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
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import type { ISpaceTransfers } from './delete-account/BlockingSpaceList';
import { BlockingSpaceList } from './delete-account/BlockingSpaceList';

export const DeleteAccountDialog = () => {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState<string>();
  // Sole-owner spaces reported by the last attempt. On the next attempt each
  // one is handed over to the chosen member, or trashed together with the
  // account when no member was chosen.
  const [blockingSpaces, setBlockingSpaces] = useState<IDeleteUserErrorData['spaces']>([]);
  const [transfers, setTransfers] = useState<ISpaceTransfers>({});
  // A subscribed space only blocks while nobody takes it over: handed over,
  // it keeps its subscription under the new owner.
  const hasSubscribedSpace = blockingSpaces.some(
    (space) => space.subscribed && !transfers[space.id]
  );

  const { mutate: deleteAccount, isPending } = useMutation({
    mutationFn: async () => {
      const toTrash: string[] = [];
      for (const space of blockingSpaces) {
        const member = transfers[space.id];
        if (!member) {
          if (!space.subscribed) toTrash.push(space.id);
          continue;
        }
        await updateSpaceCollaborator({
          spaceId: space.id,
          updateSpaceCollaborateRo: {
            principalId: member.principalId,
            principalType: member.principalType,
            role: Role.Owner,
          },
        });
      }
      return deleteUser(confirmText, toTrash);
    },
    meta: {
      preventGlobalError: true,
    },
    onError: (error: HttpError) => {
      const parsed =
        error.code === HttpErrorCode.VALIDATION_ERROR &&
        deleteUserErrorDataSchema.safeParse(error.data);
      if (parsed && parsed.success) {
        setMessage(undefined);
        setBlockingSpaces(parsed.data.spaces);
        setTransfers({});
      } else {
        setMessage(error.message);
        setBlockingSpaces([]);
      }
    },
    onSuccess: () => {
      window.location.reload();
    },
  });

  useEffect(() => {
    setConfirmText('');
    setMessage(undefined);
    setBlockingSpaces([]);
    setTransfers({});
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-fit text-destructive hover:text-destructive/80"
          size={'sm'}
        >
          {t('settings.account.deleteAccount.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-5 text-destructive" />
            {t('settings.account.deleteAccount.title')}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {t('settings.account.deleteAccount.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {message && (
            <Alert variant="destructive">
              <X className="size-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {blockingSpaces.length > 0 && (
            <BlockingSpaceList
              spaces={blockingSpaces}
              transfers={transfers}
              onTransfersChange={setTransfers}
            />
          )}
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
              className="text-[13px]"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t('settings.account.deleteAccount.confirm.placeholder')}
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => deleteAccount()}
            disabled={confirmText !== 'DELETE' || hasSubscribedSpace}
          >
            {isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {isPending ? t('settings.account.deleteAccount.loading') : t('common:actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
