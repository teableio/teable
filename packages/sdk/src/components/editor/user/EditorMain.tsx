import { useQuery } from '@tanstack/react-query';
import type { IUserCellValue, IUserFieldOptions } from '@teable-group/core';
import { Check } from '@teable-group/icons';
import { getBaseCollaboratorList } from '@teable-group/openapi';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Skeleton,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import React, { useCallback } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useBase } from '../../../hooks';
import type { ICellEditor } from '../type';

export interface IUserEditorMainProps extends ICellEditor<IUserCellValue | IUserCellValue[]> {
  options: IUserFieldOptions;
  onChange?: (value?: IUserCellValue | IUserCellValue[]) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function UserEditorMain(props: IUserEditorMainProps) {
  const { options, value: cellValue, onChange, className, style } = props;
  const { isMultiple } = options;
  const { id: baseId } = useBase();

  const { data: collaborators, isLoading } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
    queryFn: ({ queryKey }) => getBaseCollaboratorList(queryKey[1]),
  });

  const onSelect = (value: IUserCellValue) => {
    if (isMultiple) {
      const innerValue = (cellValue || []) as IUserCellValue[];
      const newValue = innerValue.some((v) => v.id === value.id)
        ? innerValue.filter((v) => v.id !== value.id)
        : [...innerValue, value];
      onChange?.(newValue);
      return;
    }
    onChange?.(value.id === (cellValue as IUserCellValue)?.id ? undefined : value);
  };

  const activeStatus = useCallback(
    (value: string) => {
      const originValue = isMultiple
        ? (cellValue as IUserCellValue[])?.map((user) => user?.id)
        : [(cellValue as IUserCellValue)?.id];

      return originValue?.includes(value);
    },
    [cellValue, isMultiple]
  );

  return (
    <Command className={className} style={style}>
      <CommandInput placeholder="Search user" />
      <CommandList>
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {isLoading ? (
            <CommandItem className="flex items-center space-x-4">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </CommandItem>
          ) : (
            collaborators?.data?.map(({ userId, userName, avatar, email }) => (
              <CommandItem
                key={userId}
                value={userName}
                onSelect={() => onSelect({ id: userId, title: userName })}
                className="flex justify-between"
              >
                <div className="flex items-center space-x-4">
                  <Avatar className="box-content h-7 w-7 cursor-pointer border">
                    <AvatarImage src={avatar as string} alt="avatar-name" />
                    <AvatarFallback className="text-sm">{userName.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium leading-none">{userName}</p>
                    <p className="text-sm text-muted-foreground">{email}</p>
                  </div>
                </div>
                <Check
                  className={classNames(
                    'ml-2 h-4 w-4',
                    activeStatus(userId) ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
