import type { IDeleteUserBlockingSpace } from '@teable/openapi';
import { useSession } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { ISpaceMember } from './SpaceMemberCombobox';
import { SpaceMemberCombobox } from './SpaceMemberCombobox';

// Recipient chosen per space; a space without one goes to trash.
export type ISpaceTransfers = Record<string, ISpaceMember | undefined>;

interface ISoleOwnerSpaceItemProps {
  space: IDeleteUserBlockingSpace;
  transferTo?: ISpaceMember;
  onTransferToChange: (member?: ISpaceMember) => void;
}

// One space the user is the only owner of. The user may pick a member to hand it over to;
// the rest are trashed together with the account. A subscribed one can only be handed
// over, or waits until its subscription is cancelled — the one thing that holds the
// deletion, and the only row drawn as such.
const SoleOwnerSpaceItem = ({
  space,
  transferTo,
  onTransferToChange,
}: ISoleOwnerSpaceItemProps) => {
  const { t } = useTranslation(['common']);
  const { user } = useSession();
  const needsCancel = space.subscribed && !transferTo;

  const outcome = needsCancel ? (
    <Button variant="outline" size="xs" asChild>
      <Link href={`/space/${space.id}`} target="_blank">
        {t('settings.account.deleteAccount.spaces.cancelSubscription')}
      </Link>
    </Button>
  ) : (
    <span className="break-all text-end text-muted-foreground">
      {transferTo
        ? t('settings.account.deleteAccount.spaces.willTransfer')
        : t('settings.account.deleteAccount.spaces.willTrash')}
    </span>
  );

  return (
    <li
      className={cn(
        'flex flex-col gap-2 overflow-hidden rounded-md border p-2',
        needsCancel && 'border-destructive/40'
      )}
    >
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
          {t('settings.account.deleteAccount.spaces.subscribedHint')}
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
                ? 'settings.account.deleteAccount.spaces.transferToSubscribed'
                : 'settings.account.deleteAccount.spaces.transferTo'
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

interface ISoleOwnerSpaceListProps {
  spaces: IDeleteUserBlockingSpace[];
  transfers: ISpaceTransfers;
  onTransfersChange: (transfers: ISpaceTransfers) => void;
}

/**
 * What leaves with the account, said before anything is pressed: the spaces this user alone
 * owns, each with what happens to it. Not a warning — the deletion is the warning — but the
 * inventory a reader wants in front of them when they type the word.
 */
export const SoleOwnerSpaceList = ({
  spaces,
  transfers,
  onTransfersChange,
}: ISoleOwnerSpaceListProps) => {
  const { t } = useTranslation(['common']);

  return (
    <section className="min-w-0 rounded-md border bg-muted/30 p-3 text-[13px]">
      <strong>{t('settings.account.deleteAccount.spaces.title')}</strong>
      <p className="mt-1 text-muted-foreground">
        {t('settings.account.deleteAccount.spaces.body')}
      </p>
      <ul className="mt-2 flex w-full min-w-0 flex-col gap-2">
        {spaces.map((space) => (
          <SoleOwnerSpaceItem
            key={space.id}
            space={space}
            transferTo={transfers[space.id]}
            onTransferToChange={(member) => onTransfersChange({ ...transfers, [space.id]: member })}
          />
        ))}
      </ul>
    </section>
  );
};
