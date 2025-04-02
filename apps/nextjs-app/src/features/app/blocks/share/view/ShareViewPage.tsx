import { ANONYMOUS_USER_ID, type DriverClient } from '@teable/core';
import type { ShareViewGetVo } from '@teable/openapi';
import {
  AnchorContext,
  AppProvider,
  FieldProvider,
  SessionProvider,
  ShareViewProxy,
  ViewProvider,
  ShareViewContext,
} from '@teable/sdk/context';
import { getWsPath } from '@teable/sdk/context/app/useConnection';
import { addQueryParamsToWebSocketUrl } from '@teable/sdk/utils';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useAutoFavicon } from '@/features/app/hooks/useAutoFavicon';
import { useBrand } from '@/features/app/hooks/useBrand';
import { useSdkLocale } from '@/features/app/hooks/useSdkLocale';
import { AppLayout } from '@/features/app/layouts';
import { ShareTablePermissionProvider } from './ShareTablePermissionProvider';
import { ShareView } from './ShareView';

export interface IShareViewPageProps {
  shareViewData: ShareViewGetVo;
  driver: DriverClient;
}

export const ShareViewPage = (props: IShareViewPageProps) => {
  const { tableId, viewId, view, fields, shareId } = props.shareViewData;
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();

  const { query } = useRouter();
  const { brandName } = useBrand();
  useAutoFavicon();

  const wsPath = useMemo(() => {
    if (typeof window === 'object') {
      return addQueryParamsToWebSocketUrl(getWsPath(), { shareId });
    }
    return undefined;
  }, [shareId]);

  return (
    <AppProvider
      lang={i18n.language}
      wsPath={wsPath}
      locale={sdkLocale}
      forcedTheme={query.theme as string}
    >
      <ShareViewContext.Provider value={props.shareViewData}>
        <Head>
          <title>{view?.name ? `${view.name} - ${brandName}` : brandName}</title>
        </Head>
        <AppLayout>
          <SessionProvider
            user={{
              id: ANONYMOUS_USER_ID,
              name: ANONYMOUS_USER_ID,
              email: '',
              notifyMeta: {},
              hasPassword: false,
              isAdmin: false,
            }}
            disabledApi
          >
            <AnchorContext.Provider
              value={{
                tableId,
                viewId,
              }}
            >
              {view && (
                <ViewProvider serverData={[view]}>
                  <ShareViewProxy serverData={[view]}>
                    <FieldProvider serverSideData={fields}>
                      <ShareTablePermissionProvider>
                        <ShareView />
                      </ShareTablePermissionProvider>
                    </FieldProvider>
                  </ShareViewProxy>
                </ViewProvider>
              )}
            </AnchorContext.Provider>
          </SessionProvider>
        </AppLayout>
      </ShareViewContext.Provider>
    </AppProvider>
  );
};
