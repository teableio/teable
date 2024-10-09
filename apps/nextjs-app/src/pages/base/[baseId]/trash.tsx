import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { BaseTrashPage } from '@/features/app/blocks/trash/BaseTrashPage';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Trash: NextPageWithLayout = () => <BaseTrashPage />;

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
          ...(await getTranslationsProps(context, tableConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Trash.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[]; baseServerData: IGetBaseVo }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Trash;
