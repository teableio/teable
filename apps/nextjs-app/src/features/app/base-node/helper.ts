import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks';
import type { BuildBaseProps, ISSRContext, SSRResult } from './types';

export const redirect = (destination: string): SSRResult => ({
  redirect: { destination, permanent: false },
});

export const handleEmptyPath = async (
  ctx: ISSRContext,
  buildBaseProps: BuildBaseProps
): Promise<SSRResult> => {
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

  return { props: await buildBaseProps(ctx) };
};
