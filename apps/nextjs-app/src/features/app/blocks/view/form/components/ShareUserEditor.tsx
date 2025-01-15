import { useQuery } from '@tanstack/react-query';
import { FieldType, type IUserCellValue } from '@teable/core';
import { getShareViewCollaborators, PrincipalType } from '@teable/openapi';
import { CellEditor } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { UserField } from '@teable/sdk/model';
import { useState } from 'react';

interface IShareUserEditor {
  shareId: string;
  field: UserField;
  cellValue?: IUserCellValue | IUserCellValue[];
  className?: string;
  onChange?: (value?: unknown) => void;
}

export const ShareUserEditor = (props: IShareUserEditor) => {
  const { className, shareId, cellValue, field, onChange } = props;
  const [search, setSearch] = useState('');

  const { data: userQuery, isLoading } = useQuery({
    queryKey: ReactQueryKeys.shareViewCollaborators(shareId, {
      search,
      skip: 0,
      take: 100,
      type: PrincipalType.User,
    }),
    queryFn: ({ queryKey }) =>
      getShareViewCollaborators(queryKey[1], queryKey[2]).then((data) => data.data),
  });
  return (
    <CellEditor
      cellValue={cellValue}
      field={field}
      onChange={onChange}
      className={className}
      context={{
        [FieldType.User]: {
          data: userQuery,
          onSearch: setSearch,
          isLoading,
        },
      }}
    />
  );
};
