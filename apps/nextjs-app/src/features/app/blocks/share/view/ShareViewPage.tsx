import type { ShareViewGetVo } from '@teable-group/openapi';
import { AnchorContext, AppProvider, FieldProvider, ViewProvider } from '@teable-group/sdk/context';
import { getWsPath } from '@teable-group/sdk/context/app/useConnection';
import { useMemo } from 'react';
import { useTitle } from 'react-use';
import { AppLayout } from '@/features/app/layouts';
import { addQueryParamsToWebSocketUrl } from '@/features/app/utils/socket-url';
import { ShareView } from './ShareView';
import { ShareViewPageContext } from './ShareViewPageContext';
import { ViewProxy } from './ViewProxy';

export interface IShareViewPageProps {
  shareViewData: ShareViewGetVo;
}

export const ShareViewPage = (props: IShareViewPageProps) => {
  const { tableId, viewId, view, fields, shareId } = props.shareViewData;

  const wsPath = useMemo(() => {
    if (typeof window === 'object') {
      return addQueryParamsToWebSocketUrl(getWsPath(), { shareId });
    }
    return undefined;
  }, [shareId]);

  useTitle(view?.name ?? 'Teable');

  return (
    <ShareViewPageContext.Provider value={props.shareViewData}>
      <AppLayout>
        <AppProvider wsPath={wsPath}>
          <AnchorContext.Provider
            value={{
              tableId,
              viewId,
            }}
          >
            <ViewProvider serverData={[view]}>
              <ViewProxy serverData={[view]}>
                <FieldProvider serverSideData={fields}>
                  <ShareView />
                </FieldProvider>
              </ViewProxy>
            </ViewProvider>
          </AnchorContext.Provider>
        </AppProvider>
      </AppLayout>
    </ShareViewPageContext.Provider>
  );
};
