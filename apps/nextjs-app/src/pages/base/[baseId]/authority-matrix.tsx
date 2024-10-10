import type { ITableVo, IGetBaseVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AuthorityMatrixPage } from '@/features/app/blocks/AuthorityMatrix';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <AuthorityMatrixPage />;

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
          ...(await getTranslationsProps(context, ['common', 'space', 'sdk'])),
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
