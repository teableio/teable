import type { IHttpError } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { IViewPageProps } from '@/lib/view-pages-data';
import { getViewPageServerData } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '@/pages/type';

const Node: NextPageWithLayout<ITableProps> = ({
  fieldServerData,
  viewServerData,
  recordsServerData,
}) => {
  return (
    <Table
      fieldServerData={fieldServerData}
      viewServerData={viewServerData}
      recordsServerData={recordsServerData}
    />
  );
};

export const getServerSideProps: GetServerSideProps<IViewPageProps> = withAuthSSR<IViewPageProps>(
  async (context) => {
    const { tableId, viewId, baseId } = context.query;
    try {
      const serverData = await getViewPageServerData(
        baseId as string,
        tableId as string,
        viewId as string
      );
      if (serverData) {
        const { i18nNamespaces } = tableConfig;
        return {
          props: {
            ...serverData,
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
  }
);

Node.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
