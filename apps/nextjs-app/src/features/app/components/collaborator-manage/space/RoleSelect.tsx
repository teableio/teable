import { Role, type IRole } from '@teable/core';
import { useSpaceRoleStatic } from '@teable/sdk/hooks';
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
interface IRoleSelect {
  className?: string;
  value?: IRole;
  defaultValue?: IRole;
  disabled?: boolean;
  filterRoles?: IRole[];
  onChange?: (value: IRole) => void;
}

export const RoleSelect: React.FC<IRoleSelect> = (props) => {
  const { className, value, defaultValue, disabled, filterRoles, onChange } = props;
  const spaceRoleList = useSpaceRoleStatic();
  const filteredRoleList = useMemo(() => {
    return filterRoles
      ? spaceRoleList.filter(({ role }) => filterRoles.includes(role))
      : spaceRoleList;
  }, [filterRoles, spaceRoleList]);

  const showSelectedRoleValue = useMemo(
    () => find(filteredRoleList, ({ role }) => role === value)?.name,
    [value, filteredRoleList]
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
        {filteredRoleList.map(({ role, name, description }) => (
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
