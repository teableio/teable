import { User } from '@teable/icons';
import { cn } from '@teable/ui-lib';
import { UserAvatar } from '../../../../cell-value';

interface IMentionUserProps {
  id: string;
  className?: string;
  name?: string;
  avatar?: string;
}

export const MentionUser = (props: IMentionUserProps) => {
  const { className, name = '', avatar } = props;

  return (
    <div className={cn('inline-flex h-[22px] max-w-32 py-px', className)}>
      {avatar ? (
        <>
          <UserAvatar avatar={avatar} name={name} className="size-4 self-center" />
          <span className="inline-flex self-baseline truncate pl-1 leading-5" title={name}>
            {name}
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
