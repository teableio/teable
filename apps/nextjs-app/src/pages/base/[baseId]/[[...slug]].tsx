import { QueryClient } from '@tanstack/react-query';
import { IdPrefix } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { CommunityPage } from '@/features/app/base/CommunityPage';
import type { ISSRContext } from '@/features/app/base-node';
import {
  TablePage,
  getTableServerSideProps,
  DashBoardPage,
  getDashboardServerSideProps,
  getWorkflowServerSideProps,
  WorkflowPage,
  getBaseServerSideProps,
  redirect,
} from '@/features/app/base-node';
import type { IBaseNodePageProps } from '@/features/app/base-node/types';
import { parseBaseSlug, useBaseResource } from '@/features/app/hooks/useBaseResource';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import ensureLogin from '@/lib/ensureLogin';
import handleBase from '@/lib/handleBase';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

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
      context.res.setHeader('Content-Security-Policy', 'frame-ancestors *;');
      const queryClient = new QueryClient();
      const base = await handleBase(baseId as string, ssrApi, queryClient);
      // Redirect legacy table URLs: /base/xxx/tbl1/viw1 → /base/xxx/table/tbl1/viw1
      if (Array.isArray(slug) && slug.length > 0 && slug[0].startsWith(IdPrefix.Table)) {
        const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
        const tablePath = slug[1] ? `${slug[0]}/${slug[1]}` : slug[0];
        const query = queryString ? `?${queryString}` : '';
        return redirect(`/base/${baseId}/table/${tablePath}${query}`);
      }

      const parsed = parseBaseSlug(slug as string[]);
      const baseIdStr = baseId as string;
      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseIdStr),
          queryFn: () => base,
        }),
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseIdStr),
          queryFn: () => ssrApi.getBasePermission(baseIdStr),
        }),
      ]);

      ssrApi.configureBaseHeaders(base);

      const i18nNamespaces = baseAllConfig.i18nNamespaces;
      const ctx: ISSRContext = {
        context,
        queryClient,
        baseId: baseIdStr,
        ssrApi,
        getTranslationsProps: () => getTranslationsProps(context, i18nNamespaces),
        base,
      };

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
