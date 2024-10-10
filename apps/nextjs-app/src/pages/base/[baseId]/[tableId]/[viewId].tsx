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

const Node: NextPageWithLayout<ITableProps> = ({
  baseServerData,
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
  groupPointsServerDataMap,
}) => {
  return (
    <Table
      baseServerData={baseServerData}
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
