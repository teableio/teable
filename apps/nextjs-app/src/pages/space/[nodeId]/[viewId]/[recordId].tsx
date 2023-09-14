import type { IHttpError, IRecord } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { IViewPageProps } from '@/lib/view-pages-data';
import { getViewPageServerData } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../../../_app';

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
    const { nodeId, viewId, recordId } = context.query;
    try {
      const api = ssrApi;
      const recordServerData = await api.getRecord(nodeId as string, recordId as string);
      if (recordServerData) {
        return {
          redirect: {
            destination: `/space/${nodeId}/${viewId}`,
            permanent: false,
          },
        };
      }
      const viewPageServerData = await getViewPageServerData(nodeId as string, viewId as string);
      if (viewPageServerData) {
        return {
          props: {
            ...viewPageServerData,
            recordServerData,
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
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Node;
