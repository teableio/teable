import { useQuery } from '@tanstack/react-query';
import { isMeTag, Me } from '@teable/core';
import { User as UserIcon } from '@teable/icons';
import { getBaseCollaboratorList } from '@teable/openapi';
import { useCallback, useMemo } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useBase, useSession } from '../../../hooks';
import type { UserField } from '../../../model';
import { UserOption, UserTag } from '../../editor';
import { BaseMultipleSelect, BaseSingleSelect } from './base';

interface IFilterUserProps {
  field: UserField;
  operator: string;
  value: string[] | string | null;
  onSelect: (value: string[] | string | null) => void;
}

interface IFilterUserBaseProps extends IFilterUserProps {
  data?: {
    userId: string;
    userName: string;
    avatar?: string | null;
  }[];
}

const SINGLE_SELECT_OPERATORS = ['is', 'isNot'];

const FilterUserSelectBase = (props: IFilterUserBaseProps) => {
  const { user: currentUser } = useSession();
  const { t } = useTranslation();
  const { value, onSelect, operator, data } = props;
  const values = useMemo<string | string[] | null>(() => value, [value]);

  const options = useMemo(() => {
    if (!data?.length) return [];

    const map = data.map(({ userId, userName, avatar }) => ({
      value: userId,
      label: userName,
      avatar: avatar,
    }));

    if (currentUser) {
      map.unshift({
        value: Me,
        label: t('filter.currentUser'),
        avatar: null,
      });
    }
    return map;
  }, [data, currentUser, t]);

  const displayRender = useCallback((option: (typeof options)[number]) => {
    return (
      <div className="rounded-lg pr-2 text-secondary-foreground" key={option.value}>
        <div className="flex items-center space-x-2">
          <UserTag
            avatar={
              isMeTag(option.value) ? (
                <span className="flex size-full items-center justify-center bg-background">
                  <UserIcon className="size-4" />
                </span>
              ) : (
                option.avatar
              )
            }
            name={option.label}
            readonly
          />
        </div>
      </div>
    );
  }, []);

  const optionRender = useCallback((option: (typeof options)[number]) => {
    return (
      <div
        key={option.value}
        className="truncate rounded-lg bg-secondary px-2 text-secondary-foreground"
      >
        <UserOption
          className="gap-2"
          avatar={
            isMeTag(option.value) ? (
              <span className="flex size-full items-center justify-center">
                <UserIcon className="size-4" />
              </span>
            ) : (
              option.avatar
            )
          }
          name={option.label}
        />
      </div>
    );
  }, []);

  return (
    <>
      {SINGLE_SELECT_OPERATORS.includes(operator) ? (
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
  const { id: baseId } = useBase();
  const { data: collaboratorsData } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
    queryFn: ({ queryKey }) => getBaseCollaboratorList(queryKey[1]),
  });
  return <FilterUserSelectBase {...props} data={collaboratorsData?.data} />;
};

export { FilterUserSelect, FilterUserSelectBase };
