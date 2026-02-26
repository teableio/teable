import { useQuery } from '@tanstack/react-query';
import { Share2 } from '@teable/icons';
import type { IBaseNodeAppResourceMeta } from '@teable/openapi';
import { BaseNodeResourceType, listBaseShare } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useShareUrlPrefix } from '@/features/app/context/ShareContext';
import type { TreeItemData } from '../base-node/hooks';

// Hook to get all shared node IDs for the current base
export const useSharedNodeIds = () => {
  const baseId = useBaseId();
  const shareUrlPrefix = useShareUrlPrefix();
  const isReadOnlyPreview = useIsReadOnlyPreview();

  // Don't fetch share list when in share mode (viewing shared page) or template mode
  const { data: shareList } = useQuery({
    queryKey: ReactQueryKeys.baseShareList(baseId as string),
    queryFn: () => listBaseShare(baseId as string).then((res) => res.data),
    enabled: !!baseId && !shareUrlPrefix && !isReadOnlyPreview,
  });

  return useMemo(() => {
    if (!shareList) return new Set<string>();
    return new Set(shareList.map((share) => share.nodeId));
  }, [shareList]);
};

interface IBaseNodeShareIndicatorProps {
  nodeId: string;
  sharedNodeIds: Set<string>;
  node?: TreeItemData;
  className?: string;
}

export const BaseNodeShareIndicator = ({
  nodeId,
  sharedNodeIds,
  node,
  className,
}: IBaseNodeShareIndicatorProps) => {
  const { t } = useTranslation(['table']);

  // For App nodes, check if it's published (has publicUrl) instead of checking sharedNodeIds
  const isAppNode = node?.resourceType === BaseNodeResourceType.App;
  const isAppPublished = isAppNode
    ? !!(node?.resourceMeta as IBaseNodeAppResourceMeta)?.publicUrl
    : false;

  // Show indicator for App nodes if published, or for other nodes if they have a share
  const shouldShow = isAppNode ? isAppPublished : sharedNodeIds.has(nodeId);

  if (!shouldShow) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center text-muted-foreground',
              className
            )}
          >
            <Share2 className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{isAppNode ? t('table:baseShare.appPublished') : t('table:baseShare.sharedNode')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
