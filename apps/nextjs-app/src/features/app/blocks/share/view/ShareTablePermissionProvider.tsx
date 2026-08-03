import { isAnonymous } from '@teable/core';
import type { ITablePermissionVo } from '@teable/openapi';
import { ShareViewContext } from '@teable/sdk/context';
import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from '@teable/sdk/context/table-permission';
import { useFields, useSession } from '@teable/sdk/hooks';
import { map } from 'lodash';
import { useContext, useMemo } from 'react';

export const ShareTablePermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const fields = useFields({ withHidden: true, withDenied: true });
  const fieldIds = map(fields, 'id');
  const { shareMeta } = useContext(ShareViewContext);
  const { user } = useSession();
  const canEdit = Boolean(shareMeta?.allowEdit) && !isAnonymous(user?.id);

  const value = useMemo(() => {
    return {
      ...TablePermissionContextDefaultValue,
      field: {
        'field|read': true,
      },
      // Share-edit grants record CRUD scoped to the shared view's table —
      // mirrors base-share's allowEdit semantics. Comment stays off: it would
      // leak internal collaboration to external link visitors.
      record: canEdit
        ? {
            'record|create': true,
            'record|update': true,
            'record|delete': true,
            'record|read': true,
            'record|comment': false,
          }
        : TablePermissionContextDefaultValue.record,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fieldIds), canEdit]) as ITablePermissionVo;

  return (
    <TablePermissionContext.Provider value={value}>{children}</TablePermissionContext.Provider>
  );
};
