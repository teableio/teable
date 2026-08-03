import { ANONYMOUS_USER_ID, type DriverClient } from '@teable/core';
import { type IUserMeVo, type ShareViewGetVo } from '@teable/openapi';
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
import { ShareContext } from '@/features/app/context/ShareContext';
import { useAutoFavicon } from '@/features/app/hooks/useAutoFavicon';
import { useBrand } from '@/features/app/hooks/useBrand';
import { useEnv } from '@/features/app/hooks/useEnv';
import { useSdkLocale } from '@/features/app/hooks/useSdkLocale';
import { AppLayout } from '@/features/app/layouts';
import { initAxios } from '@/features/app/utils/init-axios';
import { ShareTablePermissionProvider } from './ShareTablePermissionProvider';
import { ShareView } from './ShareView';

export interface IShareViewPageProps {
  shareViewData: ShareViewGetVo;
  driver: DriverClient;
  ssrUser?: IUserMeVo | null;
}

// Share view normally hardcodes ANONYMOUS user. For allowEdit shares, SSR
// (pages/share/[shareId]/view/index.tsx) probes the viewer identity and passes
// it down as ssrUser. We avoid a client-side userMe fetch because anonymous
// viewers' 401 trips the global QueryCache 401-redirect handler in
// packages/sdk/.../queryClient.tsx.
const ShareViewBody = ({
  tableId,
  viewId,
  view,
  fields,
  ssrUser,
}: {
  tableId: string;
  viewId?: string;
  view?: ShareViewGetVo['view'];
  fields?: ShareViewGetVo['fields'];
  ssrUser?: IUserMeVo | null;
}) => {
  const sessionUser = useMemo(
    () =>
      ssrUser
        ? {
            id: ssrUser.id,
            name: ssrUser.name,
            email: ssrUser.email,
            notifyMeta: ssrUser.notifyMeta ?? {},
            hasPassword: ssrUser.hasPassword ?? false,
            isAdmin: ssrUser.isAdmin ?? false,
          }
        : {
            id: ANONYMOUS_USER_ID,
            name: ANONYMOUS_USER_ID,
            email: '',
            notifyMeta: {},
            hasPassword: false,
            isAdmin: false,
          },
    [ssrUser]
  );

  return (
    <SessionProvider user={sessionUser} disabledApi>
      <AnchorContext.Provider value={{ tableId, viewId }}>
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
  );
};

export const ShareViewPage = (props: IShareViewPageProps) => {
  const { view, shareId, shareMeta } = props.shareViewData;
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { maxSearchFieldCount } = useEnv();

  // Sandbox common-endpoint permissions to share-view scope. The header signals
  // the server to derive permissions from shareMeta instead of the viewer's
  // base/space role — owner viewing their own share-edit link is also bound.
  initAxios({ shareViewId: shareId });

  const { query } = useRouter();
  const { brandName } = useBrand();
  useAutoFavicon();

  const wsPath = useMemo(() => {
    if (typeof window === 'object') {
      return addQueryParamsToWebSocketUrl(getWsPath(), { shareId });
    }
    return undefined;
  }, [shareId]);

  // Expose shareId + shareMeta to workspace components (GridViewBaseInner, etc.)
  // so existing share-aware branches inside them activate (record|copy gating,
  // button-click hook scoping, etc.). allowEdit implies allowCopy — if the
  // viewer can write the data they can trivially read it, so the explicit
  // "no copy" toggle would just be UX friction.
  const shareContextValue = useMemo(
    () => ({
      shareId,
      urlPrefix: `/share/${shareId}`,
      allowCopy: (shareMeta?.allowCopy ?? false) || (shareMeta?.allowEdit ?? false),
      allowEdit: shareMeta?.allowEdit ?? false,
    }),
    [shareId, shareMeta?.allowCopy, shareMeta?.allowEdit]
  );

  return (
    <AppProvider
      lang={i18n.language}
      wsPath={wsPath}
      locale={sdkLocale}
      forcedTheme={query.theme as string}
      maxSearchFieldCount={maxSearchFieldCount}
      shareId={shareId}
    >
      <ShareContext.Provider value={shareContextValue}>
        <ShareViewContext.Provider value={props.shareViewData}>
          <Head>
            <title>{view?.name ? `${view.name} - ${brandName}` : brandName}</title>
          </Head>
          <AppLayout>
            <ShareViewBody
              tableId={props.shareViewData.tableId}
              viewId={props.shareViewData.viewId}
              view={props.shareViewData.view}
              fields={props.shareViewData.fields}
              ssrUser={props.ssrUser ?? null}
            />
          </AppLayout>
        </ShareViewContext.Provider>
      </ShareContext.Provider>
    </AppProvider>
  );
};
