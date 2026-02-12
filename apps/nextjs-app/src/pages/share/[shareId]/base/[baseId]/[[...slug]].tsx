import { BaseNodeResourceType } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { SsrApi } from '@/backend/api/rest/ssr-api';
import type { ISSRContext } from '@/features/app/base-node';
import {
  DashBoardPage,
  getBaseServerSideProps,
  getDashboardServerSideProps,
  getTableServerSideProps,
  getWorkflowServerSideProps,
  TablePage,
  WorkflowPage,
} from '@/features/app/base-node';
import type { IShareBasePagePropsBase } from '@/features/app/blocks/share/base/share-base-ssr';
import { createShareBaseSSR } from '@/features/app/blocks/share/base/share-base-ssr';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { ShareBaseLayout } from '@/features/app/layouts/ShareBaseLayout';
import type { NextPageWithLayout } from '@/lib/type';
import withEnv from '@/lib/withEnv';

export type IShareBasePageProps = IShareBasePagePropsBase;

const ShareBasePage: NextPageWithLayout<IShareBasePageProps> = (props: IShareBasePageProps) => {
  const { resourceType } = useBaseResource();

  switch (resourceType) {
    case BaseNodeResourceType.Table:
      return <TablePage {...props} />;
    case BaseNodeResourceType.Dashboard:
      return <DashBoardPage />;
    case BaseNodeResourceType.Workflow:
      return <WorkflowPage />;
    default:
      return null;
  }
};

const getResourcePageProps = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed,
  queryParams: Record<string, string | string[] | undefined>
) => {
  if (!parsed.resourceType) {
    return getBaseServerSideProps(ctx);
  }
  switch (parsed.resourceType) {
    case BaseNodeResourceType.Table:
      return getTableServerSideProps(ctx, parsed, queryParams);
    case BaseNodeResourceType.Dashboard:
      return getDashboardServerSideProps(ctx, parsed);
    case BaseNodeResourceType.Workflow:
      return getWorkflowServerSideProps(ctx, parsed);
    default:
      return null;
  }
};

export const getServerSideProps: GetServerSideProps<IShareBasePageProps> =
  withEnv<IShareBasePageProps>(async (context) => {
    const ssrApi = new SsrApi();
    return createShareBaseSSR<IShareBasePageProps>({
      ssrApi,
      context,
      getResourcePageProps,
    });
  });

ShareBasePage.getLayout = function getLayout(page: ReactElement, pageProps: IShareBasePageProps) {
  return <ShareBaseLayout {...pageProps}>{page}</ShareBaseLayout>;
};

export default ShareBasePage;
