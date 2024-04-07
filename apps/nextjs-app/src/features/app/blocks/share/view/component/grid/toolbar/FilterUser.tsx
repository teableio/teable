import { useQuery } from '@tanstack/react-query';
import type { FieldType } from '@teable/core';
import { getShareViewCollaborators } from '@teable/openapi';
import type { IFilterComponents } from '@teable/sdk/components';
import { FilterUserSelectBase } from '@teable/sdk/components/filter/component';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useContext } from 'react';
import { ShareViewPageContext } from '../../../ShareViewPageContext';

export const FilterUser: IFilterComponents[FieldType.User] = (props) => {
  const { shareId } = useContext(ShareViewPageContext);

  const { data: userQuery } = useQuery({
    queryKey: ReactQueryKeys.shareViewCollaborators(shareId, props.field.id),
    queryFn: ({ queryKey }) => getShareViewCollaborators(queryKey[1], { fieldId: queryKey[2] }),
  });
  return <FilterUserSelectBase {...props} data={userQuery?.data} disableMe />;
};
