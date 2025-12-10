import { BaseNodeResourceType } from '@teable/openapi';
import { AutomationPage } from '@/features/app/automation/Pages';
import type { IBaseResourceParsed } from '../hooks/useBaseResource';
import type { BuildBaseProps, ISSRContext, SSRResult } from './types';

export const handleWorkflowResource = async (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed,
  buildBaseProps: BuildBaseProps
): Promise<SSRResult> => {
  if (parsed.resourceType !== BaseNodeResourceType.Workflow) return { notFound: true };

  return { props: await buildBaseProps(ctx) };
};

export const WorkflowPage = () => {
  return <AutomationPage />;
};
