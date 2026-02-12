import type { IHttpError } from '@teable/core';
import type { GetServerSideProps } from 'next';
import { SsrApi } from '@/backend/api/rest/ssr-api';
import withEnv from '@/lib/withEnv';

// This page redirects to the proper share base URL with baseId
export const getServerSideProps: GetServerSideProps = withEnv(async (context) => {
  const { res, req, query } = context;
  const { shareId } = query;
  res.setHeader('Content-Security-Policy', 'frame-ancestors *;');

  try {
    const ssrApi = new SsrApi();
    ssrApi.axios.defaults.headers['cookie'] = req.headers.cookie || '';
    const shareData = await ssrApi.getBaseShare(shareId as string);

    const { baseId, defaultUrl } = shareData;

    // Build destination URL
    let destination = `/share/${shareId}/base/${baseId}`;
    if (defaultUrl) {
      // Replace /base/xxx with /share/{shareId}/base/xxx
      destination = defaultUrl.replace(`/base/${baseId}`, `/share/${shareId}/base/${baseId}`);
    }

    return {
      redirect: {
        destination,
        permanent: false,
      },
    };
  } catch (e) {
    const error = e as IHttpError;
    if (error.status === 401) {
      return {
        redirect: {
          destination: `/share/${shareId}/base/auth`,
          permanent: false,
        },
      };
    }
    return {
      notFound: true,
    };
  }
});

// This page only redirects, no content
export default function ShareBase() {
  return null;
}
