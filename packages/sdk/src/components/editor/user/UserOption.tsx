import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib';
import { useMemo, isValidElement } from 'react';
import { convertNextImageUrl } from '../../grid-enhancements';

interface IUserTagProps {
  className?: string;
  name: string;
  email?: string;
  avatar?: string | null | React.ReactNode;
}

export const UserOption = (props: IUserTagProps) => {
  const { className, name, email, avatar } = props;
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
    <div className={cn('flex items-center gap-4', className)}>
      <Avatar className="box-content size-7 cursor-pointer border">{avatarCom}</Avatar>
      <div className="flex-1 truncate">
        <p className="truncate text-sm font-medium leading-none" title={name}>
          {name}
        </p>
        {email && (
          <p className="truncate text-sm text-muted-foreground" title={email}>
            {email}
          </p>
        )}
      </div>
    </div>
  );
};
