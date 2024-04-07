import { X } from '@teable/icons';
import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib';
import { useMemo, isValidElement } from 'react';
import { convertNextImageUrl } from '../../grid-enhancements';

interface IUserTagProps {
  className?: string;
  name: string;
  avatar?: string | null | React.ReactNode;
  readonly?: boolean;
  onDelete?: () => void;
}

export const UserTag = (props: IUserTagProps) => {
  const { className, name, avatar, readonly, onDelete } = props;

  const avatarCom = useMemo(() => {
    if (isValidElement(avatar)) {
      return avatar;
    }
    return (
      <>
        <AvatarImage
          src={
            avatar
              ? convertNextImageUrl({
                  url: avatar as string,
                  w: 64,
                  q: 75,
                })
              : undefined
          }
          alt={name}
        />
        <AvatarFallback className="text-sm">{name.slice(0, 1)}</AvatarFallback>
      </>
    );
  }, [avatar, name]);

  return (
    <div className={cn('flex items-center', className)}>
      <Avatar className="box-content size-5 cursor-pointer border">{avatarCom}</Avatar>
      <div className="-ml-3 flex items-center overflow-hidden rounded-[6px] bg-secondary pl-4 pr-2 text-sm text-secondary-foreground">
        <p className="flex-1 truncate">{name}</p>
        {!readonly && (
          <X
            className="ml-[2px] cursor-pointer opacity-50 hover:opacity-100"
            onClick={(e) => {
              if (onDelete) {
                e.preventDefault();
                onDelete();
              }
            }}
          />
        )}
      </div>
    </div>
  );
};
