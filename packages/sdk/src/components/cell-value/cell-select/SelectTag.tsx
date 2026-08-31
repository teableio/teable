import { cn } from '@teable/ui-lib';
import React from 'react';
import { useContentDir } from '../../../hooks/use-content-dir';

export interface ISelectTag {
  label: string;
  color?: string;
  backgroundColor?: string;
  className?: string;
}

export const SelectTag: React.FC<React.PropsWithChildren<ISelectTag>> = (props) => {
  const { label, color, backgroundColor, className, children } = props;
  const contentDir = useContentDir();
  return (
    <div
      className={cn(
        'max-w-full text-xs px-2 h-5 rounded-md bg-secondary text-secondary-foreground flex items-center gap-1',
        className
      )}
      style={{ color, backgroundColor }}
      title={label}
    >
      <span dir={contentDir} className="min-w-0 truncate">
        {label}
      </span>
      {children}
    </div>
  );
};
