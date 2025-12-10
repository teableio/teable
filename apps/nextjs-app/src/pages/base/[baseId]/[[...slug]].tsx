import { dehydrate, QueryClient } from '@tanstack/react-query';
import { IdPrefix } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { CommunityPage } from '@/features/app/base/CommunityPage';
import type { BuildBaseProps, ISSRContext } from '@/features/app/base-node';
import {
  TablePage,
  handleTableResource,
  DashBoardPage,
  handleDashboardResource,
  handleWorkflowResource,
  WorkflowPage,
  handleEmptyPath,
  redirect,
} from '@/features/app/base-node';
import type { IBaseNodePageProps } from '@/features/app/base-node/types';
import { parseBaseSlug, useBaseResource } from '@/features/app/hooks/useBaseResource';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const buildBaseProps: BuildBaseProps = async (ctx, extra) => ({
  ...extra,
  ...(await getTranslationsProps(ctx.context, baseAllConfig.i18nNamespaces)),
  dehydratedState: dehydrate(ctx.queryClient),
});

const UnifiedBasePage: NextPageWithLayout<IBaseNodePageProps> = (props: IBaseNodePageProps) => {
  const { resourceType } = useBaseResource();

  switch (resourceType) {
    case BaseNodeResourceType.Table:
      return <TablePage {...props} />;
    case BaseNodeResourceType.Dashboard:
      return <DashBoardPage />;
    case BaseNodeResourceType.Workflow:
      return <WorkflowPage />;
    case BaseNodeResourceType.App:
      return <div>App Page</div>;
    default:
      return <CommunityPage />;
  }
};

export const getServerSideProps: GetServerSideProps<IBaseNodePageProps> = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId, slug, ...queryParams } = context.query;
      const queryClient = new QueryClient();

      // Redirect legacy table URLs: /base/xxx/tbl1/viw1 → /base/xxx/table/tbl1/viw1
      if (Array.isArray(slug) && slug.length > 0 && slug[0].startsWith(IdPrefix.Table)) {
        const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
        const tablePath = slug[1] ? `${slug[0]}/${slug[1]}` : slug[0];
        return redirect(`/base/${baseId}/table/${tablePath}?${queryString}`);
      }

      const parsed = parseBaseSlug(slug as string[]);
      const baseIdStr = baseId as string;

      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseIdStr),
          queryFn: () => ssrApi.getBaseById(baseIdStr),
        }),
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseIdStr),
          queryFn: () => ssrApi.getBasePermission(baseIdStr),
        }),
      ]);

      const ctx: ISSRContext = { context, queryClient, baseId: baseIdStr, ssrApi };

      if (!parsed.resourceType) {
        return handleEmptyPath(ctx, buildBaseProps);
      }

      switch (parsed.resourceType) {
        case BaseNodeResourceType.Table:
          return handleTableResource(ctx, parsed, buildBaseProps, queryParams);
        case BaseNodeResourceType.Dashboard:
          return handleDashboardResource(ctx, parsed, buildBaseProps);
        case BaseNodeResourceType.Workflow:
          return handleWorkflowResource(ctx, parsed, buildBaseProps);
        case BaseNodeResourceType.App:
        default:
          return { notFound: true };
      }
    })
  )
);

UnifiedBasePage.getLayout = function getLayout(page: ReactElement, pageProps: IBaseNodePageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default UnifiedBasePage;
