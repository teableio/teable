import { cn } from '@teable/ui-lib';
import { useState } from 'react';

interface ICollapsibleProps {
  className?: string;
  children?: React.ReactElement;
}

const CollapsibleText = (props: ICollapsibleProps) => {
  const { className, children } = props;
  const [open, setOpen] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(open ? 'break-words' : 'truncate', 'w-full white-space', className)}
      onClick={() => setOpen(!open)}
      onKeyDown={() => setOpen(!open)}
    >
      {children}
    </div>
  );
};

export { CollapsibleText };
