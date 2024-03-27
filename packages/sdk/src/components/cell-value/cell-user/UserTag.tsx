import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib';
import { convertNextImageUrl } from '../../grid-enhancements';

interface IUserTag {
  label?: string;
  url?: string | null;
  className?: string;
}

export const UserTag = (props: IUserTag) => {
  const { label = 'Untitled', url, className } = props;

  return (
    <div className={cn('flex items-center', className)}>
      <Avatar className="size-6 cursor-pointer border">
        <AvatarImage
          src={convertNextImageUrl({
            url: url as string,
            w: 64,
            q: 75,
          })}
          alt={label}
        />
        <AvatarFallback className="text-sm">{label?.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="-ml-3 flex items-center overflow-hidden rounded-[6px] bg-secondary pl-4 pr-2 text-sm text-secondary-foreground">
        <p className="flex-1 truncate">{label}</p>
      </div>
    </div>
  );
};
