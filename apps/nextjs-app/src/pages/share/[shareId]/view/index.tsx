import type { IHttpError } from '@teable/core';
import type { ShareViewGetVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import type { IShareViewPageProps } from '@/features/app/blocks/share/view/ShareViewPage';
import { ShareViewPage } from '@/features/app/blocks/share/view/ShareViewPage';

export const getServerSideProps: GetServerSideProps<IShareViewPageProps> = async ({
  res,
  req,
  query,
}) => {
  const { shareId } = query;
  try {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' *;");
    ssrApi.axios.defaults.headers['cookie'] = req.headers.cookie || '';
    const shareViewData = await ssrApi.getShareView(shareId as string);
    return {
      props: { shareViewData },
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
      err: error,
      notFound: true,
    };
  }
};

export default function ShareView({ shareViewData }: { shareViewData: ShareViewGetVo }) {
  return <ShareViewPage shareViewData={shareViewData} />;
}
