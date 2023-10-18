import { Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import React, { forwardRef } from 'react';

interface IToolBarButton {
  text: string;
  isActive?: boolean;
  className?: string;
  children: React.ReactElement | React.ReactElement[];
}

const ToolBarButton = forwardRef<HTMLButtonElement, IToolBarButton>(
  (props: IToolBarButton, ref) => {
    const { children, text, isActive = false, className, ...restProps } = props;

    return (
      <Button
        variant={'ghost'}
        size={'xs'}
        className={classNames(
          'font-normal shrink-0 truncate',
          { 'bg-secondary': isActive },
          className
        )}
        ref={ref}
        {...restProps}
      >
        {children}
        <span className="hidden truncate @5xl/toolbar:inline">{text}</span>
      </Button>
    );
  }
);

ToolBarButton.displayName = 'ToolBarButton';

export { ToolBarButton };
