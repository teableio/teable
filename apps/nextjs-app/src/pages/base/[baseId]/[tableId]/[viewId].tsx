import type { IHttpError } from '@teable/core';
import type { ReactElement } from 'react';
import type { ITableProps } from '@/features/app/blocks/table/Table';
import { Table } from '@/features/app/blocks/table/Table';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import type { IViewPageProps } from '@/lib/view-pages-data';
import { getViewPageServerData } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout<ITableProps> = ({
  baseServerData,
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
}) => {
  return (
    <Table
      baseServerData={baseServerData}
      fieldServerData={fieldServerData}
      viewServerData={viewServerData}
      recordsServerData={recordsServerData}
      recordServerData={recordServerData}
    />
  );
};

export const getServerSideProps = withAuthSSR<IViewPageProps>(async (context, ssrApi) => {
  const { tableId, viewId, baseId, recordId } = context.query;
  try {
    let recordServerData;
    if (recordId) {
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
      err: '',
      notFound: true,
    };
  } catch (e) {
    const error = e as IHttpError;
    if (error.status !== 401) {
      return {
        err: '',
        notFound: true,
      };
    }
    throw error;
  }
});

Node.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
