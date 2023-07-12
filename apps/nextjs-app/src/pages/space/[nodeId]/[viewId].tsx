import type { IFieldVo, IRecord, ITableVo, IViewVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import type { ITableProps } from '@/features/app/blocks/table-list/Table';
import { Table } from '@/features/app/blocks/table-list/Table';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../../_app';

interface INodeProps {
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
  return (
    <Table
      fieldServerData={fieldServerData}
      viewServerData={viewServerData}
      recordServerData={recordServerData}
    />
  );
};

export const getServerSideProps: GetServerSideProps<INodeProps> = async (context) => {
  const { nodeId, viewId } = context.query;
  const snapshot = await new SsrApi().getFullSnapshot(nodeId as string, viewId as string);

  return {
    props: {
      tableServerData: snapshot.tables,
      fieldServerData: snapshot.fields,
      viewServerData: snapshot.views,
      recordServerData: snapshot.rows,
    },
  };
};

Node.getLayout = function getLayout(page: ReactElement, pageProps: INodeProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Node;
