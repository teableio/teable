import { HoverCard, HoverCardTrigger, HoverCardContent } from '@teable/ui-lib';
import colors from 'tailwindcss/colors';
import type { IUser } from '../../context';
import { useSession } from '../../hooks';
import { UserAvatar } from '../cell-value';

export type ICollaboratorUser = Omit<IUser, 'phone' | 'notifyMeta' | 'hasPassword' | 'isAdmin'> & {
  borderColor?: string;
};

export const CollaboratorWithHoverCard = (props: ICollaboratorUser) => {
  const { id, name, avatar, email, borderColor } = props;
  const { user } = useSession();

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div className="relative overflow-hidden">
          <UserAvatar
            name={name}
            avatar={avatar}
            className="size-6 cursor-pointer border-2"
            style={{
              borderColor: borderColor ?? colors.gray[500],
            }}
          />
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-max max-w-[160px] flex-col justify-center truncate p-2 text-sm">
        <div className="truncate">
          <span title={name}>{name}</span>
          <span className="pl-1">{id === user.id ? '(You)' : null}</span>
        </div>
        <div className="truncate">
          <span title={email}>{email}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
