import classNames from 'classnames';
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
      className={classNames(
        'text-sm px-2 rounded-lg bg-secondary text-secondary-foreground overflow-hidden',
        className
      )}
      style={{ color, backgroundColor }}
      title={label}
    >
      <p className="truncate flex-1">{label}</p>
      {children}
    </div>
  );
};
