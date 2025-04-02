import { useQuery } from '@tanstack/react-query';
import type { IUserCellValue } from '@teable/core';
import { FieldType } from '@teable/core';
import { getUserCollaborators } from '@teable/openapi';
import type { ForwardRefRenderFunction } from 'react';
import React, { forwardRef, useState } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useBaseId } from '../../../hooks';
import type { ICellEditor, ICellEditorContext } from '../type';
import type { IUserEditorRef } from './EditorBase';
import { UserEditorBase } from './EditorBase';

export interface IUserEditorMainProps extends ICellEditor<IUserCellValue | IUserCellValue[]> {
  isMultiple?: boolean;
  includeMe?: boolean;
  onChange?: (value?: IUserCellValue | IUserCellValue[]) => void;
  onSearch?: (value: string) => void;
  style?: React.CSSProperties;
  className?: string;
}

const DefaultDataWrapper = forwardRef<IUserEditorRef, IUserEditorMainProps>((props, ref) => {
  const { t } = useTranslation();
  const baseId = useBaseId();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorListUser(baseId as string, {
      search: search,
    }),
    queryFn: ({ queryKey }) =>
      getUserCollaborators(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const users = data?.users?.map((item) => ({
    userId: item.id,
    userName: item.name,
    email: item.email,
    avatar: item.avatar,
  }));

  const collaborators = props.includeMe
    ? [{ userId: 'me', userName: t('filter.currentUser'), email: '' }, ...(users || [])]
    : users;

  return (
    <UserEditorBase
      {...props}
      collaborators={collaborators}
      isLoading={isLoading}
      ref={ref}
      onSearch={setSearch}
    />
  );
});

DefaultDataWrapper.displayName = 'UserDefaultDataWrapper';

const ContextDataWrapper = forwardRef<
  IUserEditorRef,
  IUserEditorMainProps & {
    contextData: ICellEditorContext[FieldType.User];
  }
>((props, ref) => {
  const { isLoading, data, onSearch } = props.contextData;
  return (
    <UserEditorBase
      {...props}
      collaborators={data}
      isLoading={isLoading}
      ref={ref}
      onSearch={onSearch}
    />
  );
});

ContextDataWrapper.displayName = 'UserContextDataWrapper';

const UserEditorMainBase: ForwardRefRenderFunction<IUserEditorRef, IUserEditorMainProps> = (
  props,
  ref
) => {
  const contextData = props.context?.[FieldType.User];

  if (contextData) {
    return <ContextDataWrapper {...props} contextData={contextData} ref={ref} />;
  }
  return <DefaultDataWrapper {...props} ref={ref} />;
};

export const UserEditorMain = forwardRef(UserEditorMainBase);
