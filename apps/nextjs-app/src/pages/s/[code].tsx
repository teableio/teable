import type { GetServerSideProps } from 'next';
import { SsrApi } from '@/backend/api/rest/ssr-api';
import withEnv from '@/lib/withEnv';

export const getServerSideProps: GetServerSideProps = withEnv(async (context) => {
  const { code, ...restQuery } = context.query;

  if (!code || typeof code !== 'string') {
    return {
      notFound: true,
    };
  }

  try {
    const ssrApi = new SsrApi();

    // Call backend API to resolve the short link
    const data = await ssrApi.getShortLink(code);

    // Forward extra query params (e.g. theme, hideToolBar, embed) to the target path
    const searchParams = new URLSearchParams();
    Object.entries(restQuery).forEach(([key, value]) => {
      if (typeof value === 'string') {
        searchParams.set(key, value);
      } else if (Array.isArray(value)) {
        value.forEach((v) => searchParams.append(key, v));
      }
    });
    const queryString = searchParams.toString();
    const destination = queryString ? `${data.path}?${queryString}` : data.path;

    // Use 302 because the destination may become invalid (e.g. share disabled)
    return {
      redirect: {
        destination,
        permanent: false,
      },
    };
  } catch (error) {
    console.error('Short link resolve error:', error);
    return {
      notFound: true,
    };
  }
});

// This page will never be rendered because we always redirect
export default function ShortLinkPage() {
  return null;
}
