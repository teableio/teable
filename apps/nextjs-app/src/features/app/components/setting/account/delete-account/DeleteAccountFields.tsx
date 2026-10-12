import { Input, Label } from '@teable/ui-lib/shadcn';
import { Alert, AlertDescription } from '@teable/ui-lib/shadcn/ui/alert';
import { X } from 'lucide-react';
import { Trans, useTranslation } from 'next-i18next';
import { SoleOwnerSpaceList } from './SoleOwnerSpaceList';
import type { IDeleteAccountFlow } from './useDeleteAccount';

/**
 * Everything the reader answers, in the order it becomes relevant: what leaves with the
 * account, anything in the way of that, and the word that means it. Frameless on purpose —
 * a dialog and a page of its own both put their own chrome around this.
 */
export const DeleteAccountFields = ({ flow }: { flow: IDeleteAccountFlow }) => {
  const { t } = useTranslation(['common']);

  return (
    <div className="min-w-0 space-y-4">
      {flow.message && (
        <Alert variant="destructive">
          <X className="size-4" />
          <AlertDescription>{flow.message}</AlertDescription>
        </Alert>
      )}
      {flow.isLoadingSpaces && (
        <p className="text-[13px] text-muted-foreground">
          {t('settings.account.deleteAccount.spaces.loading')}
        </p>
      )}
      {flow.spaces.length > 0 && (
        <SoleOwnerSpaceList
          spaces={flow.spaces}
          transfers={flow.transfers}
          onTransfersChange={flow.setTransfers}
        />
      )}
      {flow.blocked && (
        <p className="text-[13px] text-destructive">
          {t('settings.account.deleteAccount.spaces.blockedHint')}
        </p>
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
          // 16px on a phone: anything smaller and iOS Safari zooms the page on focus.
          className="text-base sm:text-[13px]"
          value={flow.confirmText}
          onChange={(event) => flow.setConfirmText(event.target.value)}
          placeholder={t('settings.account.deleteAccount.confirm.placeholder')}
          disabled={flow.isPending}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </div>
    </div>
  );
};
