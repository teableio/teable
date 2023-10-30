import { SPACE_ROLE_LIST, SpaceRole } from '@teable-group/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import { find } from 'lodash';
import React, { useMemo } from 'react';
interface IRoleSelect {
  className?: string;
  value?: SpaceRole;
  defaultValue?: SpaceRole;
  disabled?: boolean;
  onChange?: (value: SpaceRole) => void;
}

export const RoleSelect: React.FC<IRoleSelect> = (props) => {
  const { className, value, defaultValue, disabled, onChange } = props;

  const showSelectedRoleValue = useMemo(
    () => find(SPACE_ROLE_LIST, ({ role }) => role === value)?.name,
    [value]
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
        {SPACE_ROLE_LIST.map(({ role, name, description }) => (
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
