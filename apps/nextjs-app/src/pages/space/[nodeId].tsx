import type { IFieldVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { FieldAPI } from '@/backend/api/rest/field.ssr';
import type { ITableProps } from '@/features/app/layouts/Table';
import { Table } from '@/features/app/layouts/Table';

interface INodeProps {
  fieldServerData?: IFieldVo;
}

const Node: React.FC<INodeProps> = () => {
  const router = useRouter();
  const { nodeId } = router.query;

  return <Table tableId={nodeId as string} />;
};

export default Node;

export const getServerSideProps: GetServerSideProps<ITableProps> = async (context) => {
  const { nodeId } = context.query;
  const fields = await new FieldAPI().getFields(nodeId as string);
  return {
    props: {
      tableId: nodeId as string,
      fieldServerData: fields,
    },
  };
};
