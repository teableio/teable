import type { IHttpError, IRecord } from '@teable/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import type { IViewPageProps } from '@/lib/view-pages-data';
import { getViewPageServerData } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';

interface IRecordPageProps extends IViewPageProps {
  recordServerData: IRecord;
}

const Node: NextPageWithLayout<ITableProps> = ({
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
}) => {
  return (
    <Table
      fieldServerData={fieldServerData}
      viewServerData={viewServerData}
      recordsServerData={recordsServerData}
      recordServerData={recordServerData}
    />
  );
};

export const getServerSideProps: GetServerSideProps<IRecordPageProps> =
  withAuthSSR<IRecordPageProps>(async (context) => {
    const { baseId, tableId, viewId, recordId } = context.query;
    try {
      const api = ssrApi;

      // jump to record in default view
      if (viewId === 'default') {
        const { id: defaultViewId } = await api.getDefaultViewId(
          baseId as string,
          tableId as string
        );

        return {
          redirect: {
            destination: `/base/${baseId}/${tableId}/${defaultViewId}/${recordId}`,
            permanent: false,
          },
        };
      }

      const recordServerData = await api.getRecord(tableId as string, recordId as string);

      if (!recordServerData) {
        return {
          redirect: {
            destination: `/base/${baseId}/${tableId}/${viewId}`,
            permanent: false,
          },
        };
      }
      const viewPageServerData = await getViewPageServerData(
        baseId as string,
        tableId as string,
        viewId as string
      );
      if (viewPageServerData) {
        return {
          props: {
            ...viewPageServerData,
            recordServerData,
            ...(await getTranslationsProps(context, tableConfig.i18nNamespaces)),
          },
        };
      }
      return {
        notFound: true,
      };
    } catch (e) {
      const error = e as IHttpError;
      if (error.status !== 401) {
        return {
          notFound: true,
        };
      }
      throw error;
    }
  });

Node.getLayout = function getLayout(page: ReactElement, pageProps: IRecordPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
