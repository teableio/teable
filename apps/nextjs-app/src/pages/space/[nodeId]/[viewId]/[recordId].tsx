import type { IRecord } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { IViewPageProps } from '@/lib/view-pages-data';
import { getViewPageServerData } from '@/lib/view-pages-data';
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

export const getServerSideProps: GetServerSideProps<IRecordPageProps> = async (context) => {
  const { nodeId, viewId, recordId } = context.query;
  const api = new SsrApi();
  const recordServerData = await api.getRecord(nodeId as string, recordId as string);
  if (!recordServerData.success || !recordServerData.data) {
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
        recordServerData: recordServerData.data,
      },
    };
  }
  return {
    notFound: true,
  };
};

Node.getLayout = function getLayout(page: ReactElement, pageProps: IRecordPageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Node;
