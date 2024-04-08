import { Button, cn } from '@teable/ui-lib';
import React, { forwardRef } from 'react';

interface IToolBarButton extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string | React.ReactNode;
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
        className={cn('font-normal shrink-0 truncate', { 'bg-secondary': isActive }, className)}
        ref={ref}
        {...restProps}
      >
        {children}
        {text && <span className={cn('hidden truncate', textClassName)}>{text}</span>}
      </Button>
    );
  }
);

ToolBarButton.displayName = 'ToolBarButton';

export { ToolBarButton };
