import { QueryClient, dehydrate } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk';
import type { ReactElement } from 'react';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import type { IViewPageProps } from '@/lib/view-pages-data';
import { getViewPageServerData } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Node: NextPageWithLayout<ITableProps> = ({
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
  groupPointsServerDataMap,
}) => {
  return (
    <Table
      fieldServerData={fieldServerData}
      viewServerData={viewServerData}
      recordsServerData={recordsServerData}
      recordServerData={recordServerData}
      groupPointsServerDataMap={groupPointsServerDataMap}
    />
  );
};

export const getServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR<IViewPageProps>(async (context, ssrApi) => {
      const { tableId, viewId, baseId, recordId, fromNotify: notifyId } = context.query;
      const queryClient = new QueryClient();

      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseId as string),
          queryFn: ({ queryKey }) =>
            queryKey[1] ? ssrApi.getBaseById(baseId as string) : undefined,
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseId as string),
          queryFn: ({ queryKey }) => ssrApi.getBasePermission(queryKey[1]),
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getTablePermission(baseId as string, tableId as string),
          queryFn: ({ queryKey }) => ssrApi.getTablePermission(queryKey[1], queryKey[2]),
        }),
      ]);

      let recordServerData;
      if (recordId) {
        if (notifyId) {
          await ssrApi.updateNotificationStatus(notifyId as string, { isRead: true });
        }

        recordServerData = await ssrApi.getRecord(tableId as string, recordId as string);

        if (!recordServerData) {
          return {
            redirect: {
              destination: `/base/${baseId}/${tableId}/${viewId}`,
              permanent: false,
            },
          };
        }
      }

      const serverData = await getViewPageServerData(
        ssrApi,
        baseId as string,
        tableId as string,
        viewId as string
      );

      if (serverData) {
        const { i18nNamespaces } = tableConfig;
        return {
          props: {
            ...serverData,
            ...(recordServerData ? { recordServerData } : {}),
            ...(await getTranslationsProps(context, i18nNamespaces)),
            dehydratedState: dehydrate(queryClient),
          },
        };
      }
      return {
        notFound: true,
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
