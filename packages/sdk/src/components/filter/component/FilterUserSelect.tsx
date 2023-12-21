import { useQuery } from '@tanstack/react-query';
import { getBaseCollaboratorList } from '@teable-group/openapi';
import { Avatar, AvatarFallback, AvatarImage } from '@teable-group/ui-lib';
import React, { useCallback, useMemo } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useBase } from '../../../hooks';
import type { UserField } from '../../../model';
import { BaseMultipleSelect, BaseSingleSelect } from './base';

interface IFilterUserProps {
  field: UserField;
  operator: string;
  value: string[] | null;
  onSelect: (value: string[] | string | null) => void;
}

const SINGLESELECTOPERATORS = ['is', 'isNot'];

const FilterUserSelectBase = (props: IFilterUserProps) => {
  const { id: baseId } = useBase();
  const { value, onSelect, operator } = props;
  const values = useMemo<string | string[] | null>(() => value, [value]);

  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
    queryFn: ({ queryKey }) => getBaseCollaboratorList(queryKey[1]).then(({ data }) => data),
  });

  const options = useMemo(() => {
    if (!collaborators?.length) return [];

    return collaborators.map(({ userId, userName, avatar }) => ({
      value: userId,
      label: userName,
      avatar: avatar,
    }));
  }, [collaborators]);

  const displayRender = useCallback((option: (typeof options)[number]) => {
    return (
      <div
        className="mx-1 rounded-lg bg-secondary px-2 text-secondary-foreground"
        key={option.value}
      >
        <div className="flex items-center space-x-2">
          <Avatar className="h-7 w-7  border">
            <AvatarImage src={option.avatar as string} alt="avatar-name" />
            <AvatarFallback className="text-sm">{option.label.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <p>{option.label}</p>
        </div>
      </div>
    );
  }, []);

  const optionRender = useCallback((option: (typeof options)[number]) => {
    return (
      <div
        key={option.value}
        className="truncate rounded-lg bg-secondary  text-secondary-foreground"
      >
        <div className="flex items-center space-x-2">
          <Avatar className="h-7 w-7  border">
            <AvatarImage src={option.avatar as string} alt="avatar-name" />
            <AvatarFallback className="text-sm">{option.label.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <p>{option.label}</p>
        </div>
      </div>
    );
  }, []);

  return (
    <>
      {SINGLESELECTOPERATORS.includes(operator) ? (
        <BaseSingleSelect
          options={options}
          onSelect={onSelect}
          value={values as string}
          displayRender={displayRender}
          optionRender={optionRender}
          className="w-64"
          popoverClassName="w-64"
        />
      ) : (
        <BaseMultipleSelect
          options={options}
          onSelect={onSelect}
          value={values as string[]}
          displayRender={displayRender}
          optionRender={optionRender}
          className="w-64"
          popoverClassName="w-64"
        />
      )}
    </>
  );
};

const FilterUserSelect = (props: IFilterUserProps) => {
  return <FilterUserSelectBase {...props} />;
};

export { FilterUserSelect };
