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
    const { identifier } = context.query;

    if (!identifier || typeof identifier !== 'string') {
      return {
        notFound: true,
      };
    }

    try {
      // Resolve where the template link lands, and what its link preview shows
      const data = await new SsrApi().getTemplatePermalink(identifier);
      return templateLinkResult(context, data.redirectUrl, data.preview);
    } catch (error) {
      if (isTemplateUnavailable(error)) {
        context.res.statusCode = 404;
        return {
          // a list, not a bare name: the EE build's localePath is a function, which needs one
          props: { unavailable: true, ...(await getTranslationsProps(context, ['common'])) },
        };
      }
      console.error('Template permalink error:', error);
      return {
        notFound: true,
      };
    }
  }
);

export default TemplateLinkPage;
