import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import type { ITableProps } from '@/features/app/layouts/Table';
import { Table } from '@/features/app/layouts/Table';

const Node: React.FC<ITableProps> = ({ fieldServerData, viewServerData, recordServerData }) => {
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

export default Node;

export const getServerSideProps: GetServerSideProps<ITableProps> = async (context) => {
  const { nodeId } = context.query;
  const snapshot = await new SsrApi().getSnapshot(nodeId as string);

  return {
    props: {
      tableId: nodeId as string,
      fieldServerData: snapshot.fields,
      viewServerData: snapshot.views,
      recordServerData: snapshot.recordData,
    },
  };
};
