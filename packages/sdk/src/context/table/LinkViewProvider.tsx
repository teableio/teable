import { useQuery } from '@tanstack/react-query';
import { getShareView } from '@teable/openapi';
import { map } from 'lodash';
import React, { useContext, useMemo } from 'react';
import { ReactQueryKeys } from '../../config/react-query-keys';
import { useFields } from '../../hooks';
import { addQueryParamsToWebSocketUrl } from '../../utils/urlParams';
import { AnchorContext } from '../anchor/AnchorContext';
import { AppContext } from '../app/AppContext';
import { ConnectionProvider } from '../app/ConnectionProvider';
import { getWsPath } from '../app/useConnection';
import { FieldProvider } from '../field';
import { SearchProvider } from '../query';
import { RecordProvider } from '../record';
import { TablePermissionContext, TablePermissionContextDefaultValue } from '../table-permission';
import { ShareViewContext } from './ShareViewContext';

export interface ILinkViewProvider {
  linkFieldId: string;
  linkBaseId?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

const ReadonlyFieldsPermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const fields = useFields({ withHidden: true, withDenied: true });
  const fieldIds = map(fields, 'id');

  const value = useMemo(() => {
    return {
      ...TablePermissionContextDefaultValue,
      fields: {
        'field|read': true,
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
  linkBaseId,
  children,
  fallback,
}) => {
  const parentAppContext = useContext(AppContext);
  const { data: shareData, isLoading } = useQuery({
    queryKey: ReactQueryKeys.shareView(linkFieldId),
    enabled: Boolean(linkFieldId),
    queryFn: () => getShareView(linkFieldId).then(({ data }) => data),
  });

  const wsPath = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return addQueryParamsToWebSocketUrl(getWsPath(), { shareId: linkFieldId });
  }, [linkFieldId]);

  const appContextValue = useMemo(
    () => ({ ...(parentAppContext ?? {}), shareId: linkFieldId }) as typeof parentAppContext,
    [parentAppContext, linkFieldId]
  );

  if (isLoading || !linkFieldId || !shareData) {
    return <>{fallback}</>;
  }

  const { tableId, viewId, fields } = shareData;
  return (
    <AppContext.Provider value={appContextValue}>
      <ConnectionProvider wsPath={wsPath}>
        <ShareViewContext.Provider value={shareData}>
          <AnchorContext.Provider value={{ baseId: linkBaseId, tableId, viewId }}>
            <SearchProvider>
              <FieldProvider fallback={fallback} serverSideData={fields}>
                <ReadonlyFieldsPermissionProvider>
                  <RecordProvider>{children}</RecordProvider>
                </ReadonlyFieldsPermissionProvider>
              </FieldProvider>
            </SearchProvider>
          </AnchorContext.Provider>
        </ShareViewContext.Provider>
      </ConnectionProvider>
    </AppContext.Provider>
  );
};
