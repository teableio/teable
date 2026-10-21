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
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { DeleteAccountActions } from '@overridable/DeleteAccountActions';
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

        <DialogFooter className="sm:block">
          <DeleteAccountActions flow={flow} onCancel={() => setOpen(false)} surface="dialog" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
