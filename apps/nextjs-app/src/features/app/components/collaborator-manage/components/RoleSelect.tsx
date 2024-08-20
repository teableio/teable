import { Role, type IRole } from '@teable/core';
import {
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@teable/ui-lib';
import { find } from 'lodash';
import React, { useMemo } from 'react';
import type { IRoleStatic } from '../types';
import { useRoleStatic } from '../useRoleStatic';

interface IRoleSelect {
  className?: string;
  value?: IRole;
  defaultValue?: IRole;
  disabled?: boolean;
  options: IRoleStatic[];
  onChange?: (value: IRole) => void;
}

export const RoleSelect = (props: IRoleSelect) => {
  const { className, value, defaultValue, disabled, options, onChange } = props;
  const roleStatic = useRoleStatic();
  const showSelectedRoleValue = useMemo(
    () => find(roleStatic, ({ role }) => role === value)?.name,
    [value, roleStatic]
  );

  return (
    <Select
      value={value || defaultValue}
      onValueChange={(value) => onChange?.(value as IRole)}
      disabled={disabled}
    >
      <SelectTrigger className={cn('h-8 w-32 bg-background', className)}>
        <SelectValue>{showSelectedRoleValue}</SelectValue>
      </SelectTrigger>
      <SelectContent className=" w-72">
        {options.map(({ role, name, description }) => (
          <div key={role}>
            {role === Role.Owner && <Separator />}
            <SelectItem value={role}>
              <span className="text-sm">{name}</span>
              <p className=" text-xs text-muted-foreground">{description}</p>
            </SelectItem>
          </div>
        ))}
      </SelectContent>
    </Select>
  );
};
