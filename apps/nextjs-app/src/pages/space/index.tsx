import type { ITableVo } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import { ChatWindow } from '@/features/app/components/ai-chat/ChatWindow';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

const Space: NextPageWithLayout = () => {
  return <ChatWindow />;
};

export const getServerSideProps: GetServerSideProps = async () => {
  const snapshot = await new SsrApi().getTableSnapshot();

  return {
    props: {
      tableServerData: snapshot.tables,
    },
  };
};

Space.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Space;
