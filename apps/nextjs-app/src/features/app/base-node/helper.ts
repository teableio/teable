import { dehydrate } from '@tanstack/react-query';
import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { ISSRContext, SSRResult } from './types';

export const redirect = (destination: string): SSRResult => ({
  redirect: { destination, permanent: false },
});

export const handleEmptyPath = async (ctx: ISSRContext): Promise<SSRResult> => {
  const { ssrApi, baseId } = ctx;
  const [lastVisitNode, nodes] = await Promise.all([
    ssrApi.getUserLastVisitBaseNode({ parentResourceId: baseId }),
    ssrApi.getBaseNodeList(baseId),
  ]);

  const findNode = nodes.find((n) => n.resourceId === lastVisitNode?.resourceId);
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
      ...(await getTranslationsProps(ctx.context, baseAllConfig.i18nNamespaces)),
      dehydratedState: dehydrate(ctx.queryClient),
    },
  };
};
