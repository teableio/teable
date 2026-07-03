import { useQuery } from '@tanstack/react-query';
import { isMeTag, Me } from '@teable/core';
import { User as UserIcon } from '@teable/icons';
import { getRecordGetCollaborators, getUserCollaborators } from '@teable/openapi';
import { cn, HoverCard, HoverCardContent, HoverCardPortal, HoverCardTrigger } from '@teable/ui-lib';
import { useCallback, useMemo, useState } from 'react';
import { ReactQueryKeys } from '../../../../config/react-query-keys';
import { useTranslation } from '../../../../context/app/i18n';
import { useIsReadOnlyPreview } from '../../../../hooks';
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
  onSearch?: (value: string) => void;
  onSelect: (value: string[] | string | null) => void;
  modal?: boolean;
  className?: string;
}

interface IFilterUserBaseProps extends IFilterUserProps {
  data?: {
    userId: string;
    userName: string;
    // Optional: share (anonymous) collaborator responses omit email.
    email?: string;
    avatar?: string | null;
  }[];
  disableMe?: boolean;
}

const SINGLE_SELECT_OPERATORS = ['is', 'isNot'];

const FilterUserSelectBase = (props: IFilterUserBaseProps) => {
  const { value, onSelect, operator, data, disableMe, onSearch, modal, className } = props;
  const { user: currentUser } = useSession();
  const { t } = useTranslation();
  const values = useMemo<string | string[] | null>(() => value, [value]);
  const isMultiple = !SINGLE_SELECT_OPERATORS.includes(operator);

  const options = useMemo(() => {
    if (!data?.length) return [];

    const map = data.map(({ userId, userName, email, avatar }) => ({
      value: userId,
      label: userName,
      email,
      avatar: avatar,
    }));

    if (!disableMe && currentUser) {
      map.unshift({
        value: Me,
        label: t('filter.currentUser'),
        email: currentUser.email,
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
                  <span className="flex size-5 shrink-0 items-center truncate rounded-full">
                    <UserIcon className="z-50 size-5 rounded-full border bg-secondary p-[3px]" />
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

  const optionRender = useCallback(
    (option: (typeof options)[number]) => {
      const isMe = isMeTag(option.value);
      const id = isMe ? currentUser.id : option.value;
      const name = isMe ? currentUser.name || option.label : option.label;
      const email = isMe ? currentUser.email : option.email;

      return (
        <HoverCard key={option.value} openDelay={200}>
          <HoverCardTrigger asChild>
            <div className="w-full min-w-0 truncate rounded-lg text-secondary-foreground">
              <UserOption
                className="w-full gap-2 truncate"
                avatar={
                  isMe ? (
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
          </HoverCardTrigger>
          <HoverCardPortal>
            <HoverCardContent
              side="right"
              align="start"
              sideOffset={8}
              className="flex w-max max-w-[160px] flex-col justify-center gap-1 truncate px-3 py-2 text-sm"
            >
              <div className="truncate">
                <span className="font-medium" title={name}>
                  {name}
                </span>
                <span className="pl-2 text-xs text-muted-foreground">
                  {id === currentUser.id ? `(${t('noun.you')})` : null}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                <span title={email}>{email}</span>
              </div>
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCard>
      );
    },
    [currentUser.email, currentUser.id, currentUser.name, t]
  );

  return (
    <>
      {!isMultiple ? (
        <BaseSingleSelect
          options={options}
          modal={modal}
          onSelect={onSelect}
          value={values as string}
          displayRender={displayRender}
          optionRender={optionRender}
          className={cn('flex h-8 overflow-hidden px-2', className ? className : 'w-40')}
          popoverClassName="w-max min-w-40 max-w-[min(360px,calc(100vw-32px))] [&_[cmdk-input-wrapper]]:h-8 [&_[cmdk-input-wrapper]]:px-3 [&_[cmdk-input-wrapper]]:py-0 [&_[cmdk-input]]:h-8"
          onSearch={onSearch}
        />
      ) : (
        <BaseMultipleSelect
          options={options}
          modal={modal}
          onSelect={onSelect}
          value={values as string[]}
          displayRender={displayRender}
          optionRender={optionRender}
          className={cn('h-8 px-2', className ? className : 'w-40')}
          popoverClassName="w-max min-w-40 max-w-[min(360px,calc(100vw-32px))] [&_[cmdk-input-wrapper]]:h-8 [&_[cmdk-input-wrapper]]:px-3 [&_[cmdk-input-wrapper]]:py-0 [&_[cmdk-input]]:h-8"
          onSearch={onSearch}
        />
      )}
    </>
  );
};

const defaultData = {
  users: [],
};

const FilterUserSelect = (props: IFilterUserProps) => {
  const { field } = props;
  const baseId = useBaseId();
  const [search, setSearch] = useState('');
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const { data: collaboratorsData = defaultData } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorListUser(baseId as string, {
      includeSystem: true,
      skip: 0,
      take: 100,
      search,
    }),
    queryFn: ({ queryKey }) =>
      getUserCollaborators(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: !isReadOnlyPreview,
  });

  const { data: recordCollaboratorsData } = useQuery({
    queryKey: ReactQueryKeys.recordCollaboratorList(field.tableId, {
      fieldId: field.id,
      skip: 0,
      take: 150,
      search,
    }),
    queryFn: ({ queryKey }) =>
      getRecordGetCollaborators(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: isReadOnlyPreview,
  });

  const data = isReadOnlyPreview
    ? recordCollaboratorsData
    : collaboratorsData?.users?.map((item) => ({
        userId: item.id,
        userName: item.name,
        email: item.email,
        avatar: item.avatar,
      }));

  return <FilterUserSelectBase {...props} data={data} onSearch={setSearch} />;
};

export { FilterUserSelect, FilterUserSelectBase };
