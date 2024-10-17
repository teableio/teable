import { useQuery } from '@tanstack/react-query';
import type { FieldType } from '@teable/core';
import { getShareViewCollaborators } from '@teable/openapi';
import type { IFilterComponents } from '@teable/sdk/components';
import { FilterUserSelectBase } from '@teable/sdk/components/filter/view-filter/component';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ShareViewContext } from '@teable/sdk/context';
import { useContext } from 'react';

export const FilterUser: IFilterComponents[FieldType.User] = (props) => {
  const { shareId } = useContext(ShareViewContext);

  const { data: userQuery } = useQuery({
    queryKey: ReactQueryKeys.shareViewCollaborators(shareId, props.field.id),
    queryFn: ({ queryKey }) =>
      getShareViewCollaborators(queryKey[1], { fieldId: queryKey[2] }).then((data) => data.data),
  });
  return <FilterUserSelectBase {...props} data={userQuery} disableMe />;
};
