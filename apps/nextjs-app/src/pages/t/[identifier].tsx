import type { GetServerSideProps } from 'next';
import { SsrApi } from '@/backend/api/rest/ssr-api';
import withEnv from '@/lib/withEnv';

export const getServerSideProps: GetServerSideProps = withEnv(async (context) => {
  const { identifier } = context.query;

  if (!identifier || typeof identifier !== 'string') {
    return {
      notFound: true,
    };
  }

  try {
    // Create SSR API instance
    const ssrApi = new SsrApi();

    // Call backend API to resolve permalink
    const data = await ssrApi.getTemplatePermalink(identifier as string);

    // Server-side redirect (302 - temporary redirect)
    // Use 302 because the template URL may change when republished
    return {
      redirect: {
        destination: data.redirectUrl,
        permanent: false,
      },
    };
  } catch (error) {
    // Template not found or not published
    console.error('Template permalink error:', error);
    return {
      notFound: true,
    };
  }
});

// This page will never be rendered because we always redirect
export default function TemplatePage() {
  return null;
}
