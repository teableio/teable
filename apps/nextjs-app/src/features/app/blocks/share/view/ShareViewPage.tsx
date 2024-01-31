import type { ShareViewGetVo } from '@teable/openapi';
import { AnchorContext, AppProvider, FieldProvider, ViewProvider } from '@teable/sdk/context';
import { getWsPath } from '@teable/sdk/context/app/useConnection';
import { useMemo } from 'react';
import { useTitle } from 'react-use';
import { useSdkLocale } from '@/features/app/hooks/useSdkLocale';
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
  const sdkLocale = useSdkLocale();

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
        <AppProvider wsPath={wsPath} locale={sdkLocale}>
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
