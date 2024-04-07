import { useQuery } from '@tanstack/react-query';
import { FieldType, type IUserCellValue } from '@teable/core';
import { getShareViewCollaborators } from '@teable/openapi';
import { CellEditor } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { UserField } from '@teable/sdk/model';

interface IShareUserEditor {
  shareId: string;
  field: UserField;
  cellValue?: IUserCellValue | IUserCellValue[];
  className?: string;
  onChange?: (value?: unknown) => void;
}

export const ShareUserEditor = (props: IShareUserEditor) => {
  const { className, shareId, cellValue, field, onChange } = props;
  const { data: userQuery, isLoading } = useQuery({
    queryKey: ReactQueryKeys.shareViewCollaborators(shareId),
    queryFn: ({ queryKey }) => getShareViewCollaborators(queryKey[1], {}),
  });
  return (
    <CellEditor
      cellValue={cellValue}
      field={field}
      onChange={onChange}
      className={className}
      context={{
        [FieldType.User]: {
          data: userQuery?.data,
          isLoading,
        },
      }}
    />
  );
};
