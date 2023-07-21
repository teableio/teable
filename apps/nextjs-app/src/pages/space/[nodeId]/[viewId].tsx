import type { IFieldVo, IRecord, ITableVo, IViewVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
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
  const api = new SsrApi();
  const tables = await api.getTables();
  const { fields, views, records, total } = await api.getTable(nodeId as string, viewId as string);

  return {
    props: {
      tableServerData: tables,
      fieldServerData: fields,
      viewServerData: views,
      recordServerData: { records, total },
    },
  };
};

Node.getLayout = function getLayout(page: ReactElement, pageProps: INodeProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Node;
