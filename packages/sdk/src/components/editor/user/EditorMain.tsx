import { useQuery } from '@tanstack/react-query';
import type { IUserCellValue } from '@teable/core';
import { FieldType } from '@teable/core';
import { getBaseCollaboratorList } from '@teable/openapi';
import type { ForwardRefRenderFunction } from 'react';
import React, { forwardRef } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useBase } from '../../../hooks';
import type { ICellEditor, ICellEditorContext } from '../type';
import type { IUserEditorRef } from './EditorBase';
import { UserEditorBase } from './EditorBase';

export interface IUserEditorMainProps extends ICellEditor<IUserCellValue | IUserCellValue[]> {
  isMultiple?: boolean;
  onChange?: (value?: IUserCellValue | IUserCellValue[]) => void;
  style?: React.CSSProperties;
  className?: string;
}

const DefaultDataWrapper = forwardRef<IUserEditorRef, IUserEditorMainProps>((props, ref) => {
  const { id: baseId } = useBase();
  const { data: collaborators, isLoading } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
    queryFn: ({ queryKey }) => getBaseCollaboratorList(queryKey[1]),
  });
  return (
    <UserEditorBase
      {...props}
      collaborators={collaborators?.data}
      isLoading={isLoading}
      ref={ref}
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
  const { isLoading, data } = props.contextData;
  return <UserEditorBase {...props} collaborators={data} isLoading={isLoading} ref={ref} />;
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
