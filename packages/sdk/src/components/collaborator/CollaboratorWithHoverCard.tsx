import { HoverCard, HoverCardTrigger, HoverCardContent, HoverCardPortal } from '@teable/ui-lib';
import type { ReactNode } from 'react';
import colors from 'tailwindcss/colors';
import type { IUser } from '../../context';
import { useTranslation } from '../../context/app/i18n';
import { useSession } from '../../hooks';
import { UserAvatar } from '../cell-value';

export type ICollaboratorUser = Omit<
  IUser,
  'phone' | 'notifyMeta' | 'hasPassword' | 'isAdmin' | 'avatar'
> & {
  borderColor?: string;
  avatar?: ReactNode;
};

export const CollaboratorWithHoverCard = (props: ICollaboratorUser) => {
  const { id, name, avatar, email, borderColor } = props;
  const { user } = useSession();
  const { t } = useTranslation();

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <div className="relative overflow-hidden">
          <UserAvatar
            name={name}
            avatar={avatar}
            className="size-6 cursor-pointer border"
            style={{
              borderColor: borderColor ?? colors.gray[500],
            }}
          />
        </div>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent className="flex w-max max-w-[160px] flex-col justify-center gap-1 truncate px-3 py-2 text-sm">
          <div className="truncate">
            <span className="font-medium" title={name}>
              {name}
            </span>
            <span className="pl-2 text-xs text-muted-foreground">
              {id === user.id ? `(${t('noun.you')})` : null}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            <span title={email}>{email}</span>
          </div>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
};
