import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { IViewPageProps } from '@/lib/view-pages-data';
import { getViewPageServerData } from '@/lib/view-pages-data';
import type { NextPageWithLayout } from '../../_app';

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

export const getServerSideProps: GetServerSideProps<IViewPageProps> = async (context) => {
  const { nodeId, viewId } = context.query;
  const serverData = await getViewPageServerData(nodeId as string, viewId as string);
  if (serverData) {
    return {
      props: serverData,
    };
  }
  return {
    notFound: true,
  };
};

Node.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Node;
