import { SpaceRole } from '@teable/core';
import { useSpaceRoleStatic } from '@teable/sdk/hooks';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@teable/ui-lib';
import classNames from 'classnames';
import { find } from 'lodash';
import React, { useMemo } from 'react';
interface IRoleSelect {
  className?: string;
  value?: SpaceRole;
  defaultValue?: SpaceRole;
  disabled?: boolean;
  filterRoles?: SpaceRole[];
  onChange?: (value: SpaceRole) => void;
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
      onValueChange={(value) => onChange?.(value as SpaceRole)}
      disabled={disabled}
    >
      <SelectTrigger className={classNames('h-8 w-32 bg-background', className)}>
        <SelectValue>{showSelectedRoleValue}</SelectValue>
      </SelectTrigger>
      <SelectContent className=" w-72">
        {filteredRoleList.map(({ role, name, description }) => (
          <div key={role}>
            {role === SpaceRole.Owner && <Separator />}
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
