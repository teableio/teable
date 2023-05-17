import * as SelectPrimitive from '@radix-ui/react-select';
import type { SelectItemProps } from '@radix-ui/react-select';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import classNames from 'classnames';
import React from 'react';

type ISelectItem = React.PropsWithChildren & SelectItemProps;

export const SelectItem = React.forwardRef((props: ISelectItem, ref: React.Ref<HTMLDivElement>) => {
  const { className, children, ...rest } = props;
  return (
    <SelectPrimitive.Item
      className={classNames(
        'flex items-center hover:bg-base-200 cursor-pointer rounded-sm relative h-8 pl-3 pr-8 text-sm focus-visible:outline-none',
        className
      )}
      {...rest}
      ref={ref}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute w-6 right-0 flex text-base items-center justify-center">
        <SelectIcon />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = 'SelectItem';
