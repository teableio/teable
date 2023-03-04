import type { IFieldVo, IRecord, ITableVo, IViewVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

interface INodeProps {
  tableId: string;
  tableServerData: ITableVo[];
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordServerData: { records: IRecord[]; total: number };
}

const Node: NextPageWithLayout<ITableProps> = ({
  fieldServerData,
  viewServerData,
  recordServerData,
}) => {
  const router = useRouter();
  const { nodeId } = router.query;
  return (
    <Table
      tableId={nodeId as string}
      fieldServerData={fieldServerData}
      viewServerData={viewServerData}
      recordServerData={recordServerData}
    />
  );
};

export const getServerSideProps: GetServerSideProps<INodeProps> = async (context) => {
  const { nodeId } = context.query;
  const snapshot = await new SsrApi().getFullSnapshot(nodeId as string);

  return {
    props: {
      tableId: nodeId as string,
      tableServerData: snapshot.tables,
      fieldServerData: snapshot.fields,
      viewServerData: snapshot.views,
      recordServerData: snapshot.recordData,
    },
  };
};

Node.getLayout = function getLayout(page: ReactElement, pageProps: INodeProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Node;
