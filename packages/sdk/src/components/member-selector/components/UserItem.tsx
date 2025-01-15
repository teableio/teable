import { Checkbox, cn } from '@teable/ui-lib';
import { UserAvatar } from '../../cell-value';

interface IUserItemProps {
  className?: string;
  name: string;
  email?: string;
  avatar?: string;
  checked?: boolean;
  showCheckbox?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  suffix?: React.ReactNode;
}

export const UserItem = ({
  className,
  name,
  email,
  avatar,
  checked,
  showCheckbox = true,
  onCheckedChange,
  suffix,
}: IUserItemProps) => {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 py-2 hover:bg-accent',
        className
      )}
    >
      {showCheckbox && <Checkbox checked={checked} onCheckedChange={onCheckedChange} />}
      <UserAvatar avatar={avatar} name={name} />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-[13px] font-medium">{name}</div>
        {email && <div className="line-clamp-1 text-[13px] text-muted-foreground">{email}</div>}
      </div>
      {suffix}
    </div>
  );
};
