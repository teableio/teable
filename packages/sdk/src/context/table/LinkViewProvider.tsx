import { useQuery } from '@tanstack/react-query';
import { getShareView } from '@teable/openapi';
import { map } from 'lodash';
import React, { useMemo } from 'react';
import { useFields } from '../../hooks';
import { AnchorContext } from '../anchor/AnchorContext';
import { FieldProvider } from '../field';
import { SearchProvider } from '../query';
import { RecordProvider } from '../record';
import { TablePermissionContext, TablePermissionContextDefaultValue } from '../table-permission';
import { ShareViewContext } from './ShareViewContext';

export interface ILinkViewProvider {
  linkFieldId: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

const ReadonlyFieldsPermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const fields = useFields({ withHidden: true, withDenied: true });
  const fieldIds = map(fields, 'id');

  const value = useMemo(() => {
    return {
      ...TablePermissionContextDefaultValue,
      field: {
        create: false,
        fields: fieldIds.reduce(
          (acc, fieldId) => {
            acc[fieldId] = {
              'field|read': true,
            };
            return acc;
          },
          {} as Record<string, Record<string, boolean>>
        ),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fieldIds)]);

  return (
    <TablePermissionContext.Provider value={value}>{children}</TablePermissionContext.Provider>
  );
};

export const LinkViewProvider: React.FC<ILinkViewProvider> = ({
  linkFieldId,
  children,
  fallback,
}) => {
  const { data: shareData } = useQuery({
    queryKey: ['share-view'],
    enabled: Boolean(linkFieldId),
    queryFn: () => getShareView(linkFieldId).then(({ data }) => data),
  });

  if (!linkFieldId || !shareData) {
    return;
  }

  const { tableId, viewId, fields } = shareData;
  return (
    <ShareViewContext.Provider value={shareData}>
      <AnchorContext.Provider value={{ tableId, viewId }}>
        <SearchProvider>
          <FieldProvider fallback={fallback} serverSideData={fields}>
            <ReadonlyFieldsPermissionProvider>
              <RecordProvider>{children}</RecordProvider>
            </ReadonlyFieldsPermissionProvider>
          </FieldProvider>
        </SearchProvider>
      </AnchorContext.Provider>
    </ShareViewContext.Provider>
  );
};
