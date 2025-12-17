import { dehydrate } from '@tanstack/react-query';
import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks';
import { redirect } from './helper';
import type { ISSRContext, SSRResult } from './types';

export const getBaseServerSideProps = async (ctx: ISSRContext): Promise<SSRResult> => {
  const { ssrApi, baseId, base } = ctx;
  const [lastVisitNode, nodes] = await Promise.all([
    ssrApi.getUserLastVisitBaseNode({ parentResourceId: baseId }),
    ssrApi.getBaseNodeList(baseId),
  ]);

  const findNode = nodes.find((n) => n.resourceId === lastVisitNode?.resourceId) ?? nodes[0];
  if (findNode) {
    const url = getNodeUrl({
      baseId,
      resourceType: findNode.resourceType,
      resourceId: findNode.resourceId,
    });
    if (url?.pathname) return redirect(url.pathname);
  }

  return {
    props: {
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
      base,
    },
  };
};
