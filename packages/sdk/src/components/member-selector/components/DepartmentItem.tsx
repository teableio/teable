/* eslint-disable jsx-a11y/interactive-supports-focus */
/* eslint-disable jsx-a11y/click-events-have-key-events */

import { Building2 } from '@teable/icons';
import { Checkbox, cn } from '@teable/ui-lib';

interface IDepartmentItemProps {
  className?: string;
  name: string;
  pathName?: string[];
  checked: boolean;
  onClick?: () => void;
  onCheckedChange?: (checked: boolean) => void;
  suffix?: React.ReactNode;
  showCheckbox?: boolean;
}

export const DepartmentItem = ({
  className,
  name,
  pathName,
  checked,
  suffix,
  onClick,
  onCheckedChange,
  showCheckbox = true,
}: IDepartmentItemProps) => {
  const pathLabel = pathName?.filter(Boolean).join(' / ');
  return (
    <div
      className={cn('flex items-center gap-3 rounded-lg border p-3 hover:bg-accent', className)}
      role="button"
      onClick={onClick}
    >
      {showCheckbox && (
        <Checkbox
          checked={checked}
          onCheckedChange={onCheckedChange}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <Building2 className="size-4" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <div className="line-clamp-1 shrink-0 text-[13px] font-medium">{name}</div>
        {pathLabel && (
          <div
            dir="rtl"
            className="line-clamp-1 min-w-0 text-[12px] text-muted-foreground"
            title={pathLabel}
          >
            {pathLabel}
          </div>
        )}
      </div>
      {suffix}
    </div>
  );
};
