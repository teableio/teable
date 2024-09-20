import { User } from '@teable/icons';
import { cn } from '@teable/ui-lib';
import { UserAvatar } from '../../../../cell-value';
import { useCollaborator } from '../../../hooks';

interface IMentionUserProps {
  id: string;
  className?: string;
}

export const MentionUser = (props: IMentionUserProps) => {
  const { id, className } = props;
  const user = useCollaborator(id) || {
    avatar: '',
    userName: '',
  };

  return (
    <div className={cn('inline-flex h-[22px] max-w-32 py-px', className)}>
      {user.avatar ? (
        <>
          <UserAvatar avatar={user.avatar} name={user.userName} className="size-4 self-center" />
          <span className="inline-flex self-baseline truncate pl-1 leading-5" title={user.userName}>
            {user.userName}
          </span>
        </>
      ) : (
        <div className="item-center flex size-4 shrink-0 justify-center self-center rounded-full bg-card">
          <User className="self-center" />
        </div>
      )}
    </div>
  );
};
