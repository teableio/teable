import type { DriverClient } from '@teable/core';
import type { ShareViewGetVo } from '@teable/openapi';
import { AnchorContext, AppProvider, FieldProvider, ViewProvider } from '@teable/sdk/context';
import { getWsPath } from '@teable/sdk/context/app/useConnection';
import Head from 'next/head';
import { useMemo } from 'react';
import { useSdkLocale } from '@/features/app/hooks/useSdkLocale';
import { AppLayout } from '@/features/app/layouts';
import { addQueryParamsToWebSocketUrl } from '@/features/app/utils/socket-url';
import { ShareView } from './ShareView';
import { ShareViewPageContext } from './ShareViewPageContext';
import { ViewProxy } from './ViewProxy';

export interface IShareViewPageProps {
  shareViewData: ShareViewGetVo;
  driver: DriverClient;
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

  return (
    <ShareViewPageContext.Provider value={props.shareViewData}>
      <Head>
        <title>{view?.name ?? 'Teable'}</title>
      </Head>
      <AppLayout>
        <AppProvider wsPath={wsPath} locale={sdkLocale} driver={props.driver}>
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
