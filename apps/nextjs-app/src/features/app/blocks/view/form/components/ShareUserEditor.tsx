import { useQuery } from '@tanstack/react-query';
import { FieldType, type IUserCellValue } from '@teable/core';
import { getShareViewCollaborators } from '@teable/openapi';
import { CellEditor } from '@teable/sdk/components';
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
    queryKey: ['share-view-collaborators', shareId, field.id],
    queryFn: ({ queryKey }) => getShareViewCollaborators(queryKey[1], { fieldId: queryKey[2] }),
  });
  return (
    <CellEditor
      cellValue={cellValue}
      field={field}
      onChange={onChange}
      className={className}
      context={{
        [FieldType.User]: {
          data: userQuery?.data
            ? [
                ...userQuery.data,
                ...new Array(10).fill(0).map((_i, index) => {
                  return {
                    userId: `fake-user-${index}`,
                    userName: `Fake User ${index}`,
                    avatar:
                      'http://127.0.0.1:3000/api/attachments/read/public/avatar/usrm8gdaVtKFx9KIM5S',
                    email: `fake${index}@gamil.com`,
                  };
                }),
              ]
            : [],
          isLoading,
        },
      }}
    />
  );
};
