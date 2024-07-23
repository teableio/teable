import type { ITableVo, IGetBaseVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AutomationPage } from '@/features/app/automation/Pages';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { automationConfig } from '@/features/i18n/automation';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => <AutomationPage />;

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { baseId } = context.query;
  const result = (await ssrApi.getTables(baseId as string)).data;
  const base = (await ssrApi.getBaseById(baseId as string)).data;
  return {
    props: {
      tableServerData: result,
      baseServerData: base,
      ...(await getTranslationsProps(context, automationConfig.i18nNamespaces)),
    },
  };
});

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[]; baseServerData: IGetBaseVo }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
