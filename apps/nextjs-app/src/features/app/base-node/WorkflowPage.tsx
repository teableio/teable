import { dehydrate } from '@tanstack/react-query';
import { BaseNodeResourceType } from '@teable/openapi';
import { AutomationPage } from '@/features/app/automation/Pages';
import type { IBaseResourceParsed } from '../hooks/useBaseResource';
import { getDefaultNodeUrl, redirect } from './helper';
import type { ISSRContext, SSRResult } from './types';

export const getWorkflowServerSideProps = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed
): Promise<SSRResult> => {
  const { baseId, base } = ctx;
  if (parsed.resourceType !== BaseNodeResourceType.Workflow) return { notFound: true };

  const { workflowId } = parsed;

  // If workflowId is provided, check if it exists by checking base nodes
  if (workflowId) {
    const nodes = await ctx.ssrApi.getBaseNodeList(baseId);
    const workflowExists = nodes.some(
      (node) =>
        node.resourceType === BaseNodeResourceType.Workflow && node.resourceId === workflowId
    );

    if (!workflowExists) {
      // Workflow not found, redirect to default node
      const defaultUrl = await getDefaultNodeUrl(ctx);
      if (defaultUrl) {
        return redirect(defaultUrl);
      }
      return { notFound: true };
    }
  }

  return {
    props: {
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
      base,
    },
  };
};

export const WorkflowPage = () => {
  return <AutomationPage />;
};
