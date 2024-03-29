import { cn } from '@teable/ui-lib';
import React from 'react';

export interface ISelectTag {
  label: string;
  color?: string;
  backgroundColor?: string;
  className?: string;
}

export const SelectTag: React.FC<React.PropsWithChildren<ISelectTag>> = (props) => {
  const { label, color, backgroundColor, className, children } = props;
  return (
    <div
      className={cn(
        'text-sm px-2 rounded-[6px] bg-secondary text-secondary-foreground overflow-hidden',
        className
      )}
      style={{ color, backgroundColor }}
      title={label}
    >
      <p className="flex-1 truncate">{label}</p>
      {children}
    </div>
  );
};
