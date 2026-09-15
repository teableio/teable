import type { IDeleteUserBlockingSpace } from '@teable/openapi';
import { useSession } from '@teable/sdk';
import { Button } from '@teable/ui-lib/shadcn';
import { Alert, AlertDescription } from '@teable/ui-lib/shadcn/ui/alert';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { ISpaceMember } from './SpaceMemberCombobox';
import { SpaceMemberCombobox } from './SpaceMemberCombobox';

// Recipient chosen per space; a space without one goes to trash.
export type ISpaceTransfers = Record<string, ISpaceMember | undefined>;

interface IBlockingSpaceItemProps {
  space: IDeleteUserBlockingSpace;
  transferTo?: ISpaceMember;
  onTransferToChange: (member?: ISpaceMember) => void;
}

// One space the user is the only owner of. The user may pick a member to hand
// it over to; the rest are trashed together with the account. A subscribed one
// can only be handed over, or blocks until its subscription is cancelled.
const BlockingSpaceItem = ({ space, transferTo, onTransferToChange }: IBlockingSpaceItemProps) => {
  const { t } = useTranslation(['common']);
  const { user } = useSession();
  const needsCancel = space.subscribed && !transferTo;

  const outcome = needsCancel ? (
    <Button variant="outline" size="xs" asChild>
      <Link href={`/space/${space.id}`} target="_blank">
        {t('settings.account.deleteAccount.error.cancelSubscription')}
      </Link>
    </Button>
  ) : (
    <span className="break-all text-end text-muted-foreground">
      {transferTo
        ? t('settings.account.deleteAccount.error.willTransfer')
        : t('settings.account.deleteAccount.error.willTrash')}
    </span>
  );

  return (
    <li className="flex flex-col gap-2 overflow-hidden rounded-md border border-destructive/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/space/${space.id}`}
          target="_blank"
          className="min-w-0 truncate font-medium underline"
        >
          {space.name}
        </Link>
        {outcome}
      </div>
      {needsCancel && (
        <p className="text-muted-foreground">
          {t('settings.account.deleteAccount.error.subscribedHint')}
        </p>
      )}
      {space.hasOtherMembers && (
        <div className="flex items-center gap-2">
          <SpaceMemberCombobox
            className="flex-1"
            spaceId={space.id}
            value={transferTo}
            onChange={onTransferToChange}
            excludeUserId={user.id}
            placeholder={t(
              needsCancel
                ? 'settings.account.deleteAccount.error.transferToSubscribed'
                : 'settings.account.deleteAccount.error.transferTo'
            )}
          />
          {transferTo && (
            <Button
              variant="ghost"
              size="xs"
              className="size-7 p-0"
              onClick={() => onTransferToChange(undefined)}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
};

interface IBlockingSpaceListProps {
  spaces: IDeleteUserBlockingSpace[];
  transfers: ISpaceTransfers;
  onTransfersChange: (transfers: ISpaceTransfers) => void;
}

export const BlockingSpaceList = ({
  spaces,
  transfers,
  onTransfersChange,
}: IBlockingSpaceListProps) => {
  const { t } = useTranslation(['common']);

  return (
    <Alert variant="destructive">
      <X className="size-4" />
      {/* AlertDescription is a grid with justify-items-start: the list must claim the column */}
      <AlertDescription className="min-w-0 text-[13px]">
        <strong>{t('settings.account.deleteAccount.error.title')}</strong>
        <p className="mt-1">{t('settings.account.deleteAccount.error.spacesError')}</p>
        <ul className="mt-2 flex w-full min-w-0 flex-col gap-2">
          {spaces.map((space) => (
            <BlockingSpaceItem
              key={space.id}
              space={space}
              transferTo={transfers[space.id]}
              onTransferToChange={(member) =>
                onTransfersChange({ ...transfers, [space.id]: member })
              }
            />
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
};
