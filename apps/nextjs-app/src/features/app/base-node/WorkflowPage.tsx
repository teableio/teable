import { dehydrate } from '@tanstack/react-query';
import { BaseNodeResourceType } from '@teable/openapi';
import { AutomationPage } from '@/features/app/automation/Pages';
import { getTranslationsProps } from '@/lib/i18n';
import type { IBaseResourceParsed } from '../hooks/useBaseResource';
import type { ISSRContext, SSRResult } from './types';

export const getWorkflowServerSideProps = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed
): Promise<SSRResult> => {
  if (parsed.resourceType !== BaseNodeResourceType.Workflow) return { notFound: true };

  return {
    props: {
      ...(await getTranslationsProps(ctx.context, ctx.i18nNamespaces)),
      dehydratedState: dehydrate(ctx.queryClient),
    },
  };
};

export const WorkflowPage = () => {
  return <AutomationPage />;
};
