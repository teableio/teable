import { useQuery } from '@tanstack/react-query';
import { isMeTag, Me } from '@teable/core';
import { User as UserIcon } from '@teable/icons';
import { getBaseCollaboratorList } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
import { useCallback, useMemo } from 'react';
import { ReactQueryKeys } from '../../../../config/react-query-keys';
import { useTranslation } from '../../../../context/app/i18n';
import { useBaseId } from '../../../../hooks/use-base-id';
import { useSession } from '../../../../hooks/use-session';
import type { UserField, CreatedByField, LastModifiedByField } from '../../../../model';
import { UserTag } from '../../../cell-value';
import { UserOption } from '../../../editor';
import { BaseMultipleSelect, BaseSingleSelect } from './base';

interface IFilterUserProps {
  field: UserField | CreatedByField | LastModifiedByField;
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
  disableMe?: boolean;
}

const SINGLE_SELECT_OPERATORS = ['is', 'isNot'];

const FilterUserSelectBase = (props: IFilterUserBaseProps) => {
  const { value, onSelect, operator, data, disableMe } = props;
  const { user: currentUser } = useSession();
  const { t } = useTranslation();
  const values = useMemo<string | string[] | null>(() => value, [value]);
  const isMultiple = !SINGLE_SELECT_OPERATORS.includes(operator);

  const options = useMemo(() => {
    if (!data?.length) return [];

    const map = data.map(({ userId, userName, avatar }) => ({
      value: userId,
      label: userName,
      avatar: avatar,
    }));

    if (!disableMe && currentUser) {
      map.unshift({
        value: Me,
        label: t('filter.currentUser'),
        avatar: null,
      });
    }
    return map;
  }, [data, disableMe, currentUser, t]);

  const displayRender = useCallback(
    (option: (typeof options)[number]) => {
      return (
        <div
          className={cn('gap-1 rounded-lg text-secondary-foreground', {
            'max-w-full overflow-hidden': !isMultiple,
          })}
          key={option.value}
        >
          <div
            className={cn('flex items-center space-x-2 flex-1', {
              truncate: !isMultiple,
            })}
          >
            <UserTag
              avatar={
                isMeTag(option.value) ? (
                  <span className="flex shrink-0 items-center truncate rounded-full">
                    <UserIcon className="z-50 size-6 rounded-full border bg-secondary p-1" />
                  </span>
                ) : (
                  option.avatar
                )
              }
              name={option.label}
              className="flex-1 truncate"
            />
          </div>
        </div>
      );
    },
    [isMultiple]
  );

  const optionRender = useCallback((option: (typeof options)[number]) => {
    return (
      <div key={option.value} className="px w-full truncate rounded-lg text-secondary-foreground">
        <UserOption
          className="w-full gap-2 truncate"
          avatar={
            isMeTag(option.value) ? (
              <span className="flex size-full items-center justify-center bg-secondary">
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
      {!isMultiple ? (
        <BaseSingleSelect
          options={options}
          onSelect={onSelect}
          value={values as string}
          displayRender={displayRender}
          optionRender={optionRender}
          className="flex w-64 overflow-hidden"
          popoverClassName="w-64"
          placeholderClassName="text-xs"
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
          placeholderClassName="text-xs"
        />
      )}
    </>
  );
};

const FilterUserSelect = (props: IFilterUserProps) => {
  const baseId = useBaseId();
  const { data: collaboratorsData } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId as string, { includeSystem: true }),
    queryFn: ({ queryKey }) =>
      getBaseCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });
  return collaboratorsData && <FilterUserSelectBase {...props} data={collaboratorsData} />;
};

export { FilterUserSelect, FilterUserSelectBase };
