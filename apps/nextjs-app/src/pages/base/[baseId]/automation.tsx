import type { ITableVo, IGetBaseVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AutomationPage } from '@/features/app/automation/Pages';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { automationConfig } from '@/features/i18n/automation';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <AutomationPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId } = context.query;
      const result = await ssrApi.getTables(baseId as string);
      const base = await ssrApi.getBaseById(baseId as string);
      return {
        props: {
          tableServerData: result,
          baseServerData: base,
          ...(await getTranslationsProps(context, automationConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[]; baseServerData: IGetBaseVo }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
