import { Button, cn } from '@teable/ui-lib/shadcn';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { IDeleteAccountFlow } from './useDeleteAccount';

export interface IDeleteAccountActionsProps {
  flow: IDeleteAccountFlow;
  onCancel: () => void;
  /** The page stacks full-width buttons on a phone; the dialog keeps them in a row. */
  surface: 'dialog' | 'page';
}

const buttonClass = (surface: IDeleteAccountActionsProps['surface']) =>
  surface === 'page' ? 'h-11 w-full sm:h-9 sm:w-auto' : undefined;

/**
 * Cancel and the press that deletes, shared by the dialog and the page. Mapped through
 * `@overridable/DeleteAccountActions` so the enterprise edition can put one more choice next
 * to them (a copy of the data, mailed before the account goes); here they are the two buttons.
 */
export const DeleteAccountActions = ({ flow, onCancel, surface }: IDeleteAccountActionsProps) => {
  const { t } = useTranslation(['common']);
  return (
    <div
      className={cn(
        'flex gap-2',
        surface === 'page' ? 'flex-col-reverse sm:flex-row sm:justify-end' : 'justify-end'
      )}
    >
      <Button
        variant="outline"
        size="sm"
        className={buttonClass(surface)}
        onClick={onCancel}
        disabled={flow.isPending}
      >
        {t('common:actions.cancel')}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        className={buttonClass(surface)}
        onClick={flow.submit}
        disabled={!flow.canSubmit}
      >
        {flow.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {flow.isPending ? t('settings.account.deleteAccount.loading') : t('common:actions.delete')}
      </Button>
    </div>
  );
};
