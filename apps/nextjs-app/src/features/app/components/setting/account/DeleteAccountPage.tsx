import { Button } from '@teable/ui-lib/shadcn';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { SettingTabShell } from '../SettingTabShell';
import { DeleteAccountFields } from './delete-account/DeleteAccountFields';
import { useDeleteAccount } from './delete-account/useDeleteAccount';

/**
 * Deleting an account, as a page rather than a dialog.
 *
 * This is the surface the phone app opens: a dialog inside a web view is a sheet inside a
 * screen inside a sheet, and the part that matters — the list of spaces still to settle, one
 * of which may need a subscription cancelled somewhere else entirely — is exactly the part a
 * dialog has no room for. The flow itself is the same one the desktop dialog runs
 * (`useDeleteAccount`); only the frame around it differs.
 *
 * The two actions sit in the shell's footer, which keeps them in reach above the home
 * indicator while the spaces above scroll.
 */
export const DeleteAccountPage = () => {
  const { t } = useTranslation(['common']);
  const router = useRouter();
  // The account is gone, so is its session: reloading lands on sign-in, which is also how
  // the phone app learns to let go of its own (it watches for that page).
  const flow = useDeleteAccount({ onDeleted: () => window.location.reload() });

  return (
    <SettingTabShell
      title={t('settings.account.deleteAccount.title')}
      description={t('settings.account.deleteAccount.desc')}
      leading={<AlertTriangle className="size-5 shrink-0 text-destructive" />}
      mobileNavigation={false}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto"
            onClick={() => router.back()}
            disabled={flow.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            className="h-11 w-full sm:h-9 sm:w-auto"
            onClick={flow.submit}
            disabled={!flow.canSubmit}
          >
            {flow.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {flow.isPending
              ? t('settings.account.deleteAccount.loading')
              : t('settings.account.deleteAccount.title')}
          </Button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-lg">
        <DeleteAccountFields flow={flow} />
      </div>
    </SettingTabShell>
  );
};
