import { parseDsn, type DriverClient, type IHttpError } from '@teable/core';
import type { ShareViewGetVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import type { IShareViewPageProps } from '@/features/app/blocks/share/view/ShareViewPage';
import { ShareViewPage } from '@/features/app/blocks/share/view/ShareViewPage';
import { shareConfig } from '@/features/i18n/share.config';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

export const getServerSideProps: GetServerSideProps<IShareViewPageProps> =
  withEnv<IShareViewPageProps>(async (context) => {
    const { res, req, query } = context;
    const { shareId } = query;
    const { i18nNamespaces } = shareConfig;
    res.setHeader('Content-Security-Policy', 'frame-ancestors *;');

    try {
      const ssrApi = new SsrApi();
      ssrApi.axios.defaults.headers['cookie'] = req.headers.cookie || '';
      const shareViewData = await ssrApi.getShareView(shareId as string);
      const driver = parseDsn(process.env.PRISMA_DATABASE_URL as string).driver as DriverClient;
      if (shareViewData.shareMeta?.submit?.requireLogin) {
        const user = await ssrApi.getUserMe().catch(() => null);
        if (!user) {
          return {
            redirect: {
              destination: `/auth/login?redirect=${encodeURIComponent(req?.url || '')}`,
              permanent: false,
            },
          };
        }
      }
      return {
        props: {
          shareViewData,
          driver,
          ...(await getTranslationsProps(context, i18nNamespaces)),
        },
      };
    } catch (e) {
      const error = e as IHttpError;
      if (error.status === 401) {
        return {
          redirect: {
            destination: `/share/${shareId}/view/auth`,
            permanent: false,
          },
        };
      }
      return {
        notFound: true,
      };
    }
  });

export default function ShareView({
  shareViewData,
  driver,
}: {
  shareViewData: ShareViewGetVo;
  driver: DriverClient;
}) {
  return <ShareViewPage shareViewData={shareViewData} driver={driver} />;
}
