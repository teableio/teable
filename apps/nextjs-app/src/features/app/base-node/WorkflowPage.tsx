import { dehydrate } from '@tanstack/react-query';
import { BaseNodeResourceType } from '@teable/openapi';
import { AutomationPage } from '@/features/app/automation/Pages';
import type { IBaseResourceParsed } from '../hooks/useBaseResource';
import type { ISSRContext, SSRResult } from './types';

export const getWorkflowServerSideProps = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed
): Promise<SSRResult> => {
  if (parsed.resourceType !== BaseNodeResourceType.Workflow) return { notFound: true };

  return {
    props: {
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
    },
  };
};

export const WorkflowPage = () => {
  return <AutomationPage />;
};
