import type { GetServerSideProps } from 'next';
import { SsrApi } from '@/backend/api/rest/ssr-api';
import {
  isTemplateUnavailable,
  templateLinkResult,
  type ITemplateLinkPageProps,
} from '@/features/app/components/space/template/link/link-preview';
import { TemplateLinkPage } from '@/features/app/components/space/template/link/TemplateLinkPage';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

export const getServerSideProps: GetServerSideProps<ITemplateLinkPageProps> = withEnv(
  async (context) => {
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

      // A template link draws a preview card for link-preview crawlers; anything else, and
      // everyone else, is redirected (302: the destination may become invalid, e.g. share disabled)
      return templateLinkResult(context, destination, data.preview);
    } catch (error) {
      // Only a template link answers this way: the template was withdrawn, refused or taken off
      if (isTemplateUnavailable(error)) {
        context.res.statusCode = 404;
        return {
          // a list, not a bare name: the EE build's localePath is a function, which needs one
          props: { unavailable: true, ...(await getTranslationsProps(context, ['common'])) },
        };
      }
      console.error('Short link resolve error:', error);
      return {
        notFound: true,
      };
    }
  }
);

export default TemplateLinkPage;
