import classNames from 'classnames';
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
      className={classNames(open ? 'break-words' : 'truncate', 'w-full white-space', className)}
      onClick={() => setOpen(!open)}
      onKeyDown={() => setOpen(!open)}
    >
      {children}
    </div>
  );
};

export { CollapsibleText };
