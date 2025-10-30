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
        'text-xs px-2 h-5 rounded-md bg-secondary text-secondary-foreground flex items-center gap-1',
        className
      )}
      style={{ color, backgroundColor }}
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
      {children}
    </div>
  );
};
