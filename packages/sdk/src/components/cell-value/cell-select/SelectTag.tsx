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
        'text-[13px] px-2 h-5 rounded-md bg-secondary text-secondary-foreground',
        className
      )}
      style={{ color, backgroundColor }}
      title={label}
    >
      {label}
      {children}
    </div>
  );
};
