import { User } from '@teable/icons';
import { cn } from '@teable/ui-lib';
import { UserAvatar } from '../../../../cell-value';

interface IMentionUserProps {
  id: string;
  className?: string;
  name?: string;
  avatar?: string;
}

/**
 * Chip look shared by the editor and the comment list. 20px tall so it fits a 24px
 * line with room between rows; aligned on the name's baseline so it sits level with
 * the surrounding text.
 */
export const mentionChipClassName = 'mx-0.5 h-5 rounded-md bg-secondary px-1 py-0 align-baseline';

export const MentionUser = (props: IMentionUserProps) => {
  const { className, name = '', avatar } = props;

  return (
    <div className={cn('inline-flex h-[22px] max-w-32 py-px', className)}>
      {avatar ? (
        <>
          <UserAvatar avatar={avatar} name={name} className="size-4 self-center" />
          <span className="inline-flex self-baseline truncate ps-1 leading-5" title={name}>
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
