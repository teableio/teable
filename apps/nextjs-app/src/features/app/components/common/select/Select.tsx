import * as SelectPrimitive from '@radix-ui/react-select';
import ArrowDownIcon from '@teable-group/ui-lib/icons/app/arrow-down.svg';
import classNames from 'classnames';
import React from 'react';

type ISelectProps = SelectPrimitive.SelectProps & {
  placeholder?: string;
  size?: 'large' | 'medium' | 'small';
};

export const Select = React.forwardRef(
  (props: ISelectProps, forwardedRef: React.Ref<HTMLButtonElement>) => {
    const { children, placeholder, size = 'medium', ...rest } = props;
    return (
      <SelectPrimitive.Root {...rest}>
        <SelectPrimitive.Trigger
          className={classNames(
            'select select-bordered focus:outline-none w-full max-w-xs flex items-center',
            {
              'select-sm': size === 'small',
              'select-lg': size === 'large',
            }
          )}
          ref={forwardedRef}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal className="card bg-base-100 p-2 shadow-xl">
          <SelectPrimitive.Content position="popper">
            <SelectPrimitive.ScrollUpButton>
              <ArrowDownIcon className="rotate-180" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton>
              <ArrowDownIcon />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );
  }
);

Select.displayName = 'Select';
