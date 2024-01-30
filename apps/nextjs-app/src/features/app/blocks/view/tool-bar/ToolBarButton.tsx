import { Button } from '@teable/ui-lib';
import classNames from 'classnames';
import React, { forwardRef } from 'react';

interface IToolBarButton {
  text?: string;
  isActive?: boolean;
  className?: string;
  textClassName?: string;
  children: React.ReactElement | React.ReactElement[];
  disabled?: boolean;
}

const ToolBarButton = forwardRef<HTMLButtonElement, IToolBarButton>(
  (props: IToolBarButton, ref) => {
    const { children, text, isActive = false, className, textClassName, ...restProps } = props;

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
        {text && (
          <span
            className={classNames(
              'hidden truncate',
              textClassName ? textClassName : '@2xl/toolbar:inline'
            )}
          >
            {text}
          </span>
        )}
      </Button>
    );
  }
);

ToolBarButton.displayName = 'ToolBarButton';

export { ToolBarButton };
