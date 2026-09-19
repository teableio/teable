import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { DeleteAccountFields } from './delete-account/DeleteAccountFields';
import { useDeleteAccount } from './delete-account/useDeleteAccount';

/**
 * The desktop entry: the same flow as `/setting/account/delete`, in a dialog, because on a
 * settings page wide enough to hold one there is no reason to leave the page behind. The
 * phone app opens the page instead — see `DeleteAccountPage`.
 */
export const DeleteAccountDialog = () => {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const flow = useDeleteAccount({ onDeleted: () => window.location.reload() });
  const { reset } = flow;

  useEffect(() => reset(), [open, reset]);

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

        <DeleteAccountFields flow={flow} />

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={flow.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button variant="destructive" size="sm" onClick={flow.submit} disabled={!flow.canSubmit}>
            {flow.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {flow.isPending
              ? t('settings.account.deleteAccount.loading')
              : t('common:actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
