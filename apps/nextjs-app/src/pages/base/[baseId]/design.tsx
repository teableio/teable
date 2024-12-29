import type { ReactElement } from 'react';
import { Design } from '@/features/app/blocks/design/Design';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import type { IDesignPageProps } from '@/lib/design-pages-data';
import { getDesignPageServerData } from '@/lib/design-pages-data';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import type { IViewPageProps } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout<IDesignPageProps> = () => {
  return <Design />;
};

export const getServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR<IDesignPageProps>(async (context, ssrApi) => {
      const { baseId } = context.query;
      const pageData = await getDesignPageServerData(ssrApi, baseId as string);
      if (pageData) {
        const { i18nNamespaces } = tableConfig;
        return {
          props: {
            ...pageData,
            ...(await getTranslationsProps(context, i18nNamespaces)),
          },
        };
      }
      return {
        notFound: true,
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
