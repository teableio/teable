import type { IHttpError } from '@teable-group/core';
import type { ReactElement } from 'react';
import { Design } from '@/features/app/blocks/design/Design';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { viewConfig } from '@/features/i18n/view.config';
import type { IDesignPageProps } from '@/lib/design-pages-data';
import { getDesignPageServerData } from '@/lib/design-pages-data';
import { getTranslationsProps } from '@/lib/i18n';
import type { IViewPageProps } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../../../_app';

const Node: NextPageWithLayout<IDesignPageProps> = (props) => {
  return <Design {...props} />;
};

export const getServerSideProps = withAuthSSR<IDesignPageProps>(async (context) => {
  const { tableId, baseId } = context.query;
  try {
    const pageData = await getDesignPageServerData(baseId as string, tableId as string);
    if (pageData) {
      const { i18nNamespaces } = viewConfig;
      return {
        props: {
          ...pageData,
          ...(await getTranslationsProps(context, i18nNamespaces)),
        },
      };
    }
    return {
      err: '',
      notFound: true,
    };
  } catch (e) {
    const error = e as IHttpError;
    if (error.status !== 401) {
      return {
        err: '',
        notFound: true,
      };
    }
    throw error;
  }
});

Node.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
