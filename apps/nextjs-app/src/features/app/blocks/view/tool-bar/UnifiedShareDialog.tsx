import { BaseNodeResourceType } from '@teable/openapi';
import { useBaseId, useView } from '@teable/sdk/hooks';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useBaseNodeContext } from '@/features/app/blocks/base/base-node/hooks/useBaseNodeContext';
import {
  NodeShareContent,
  NodeShareHeader,
} from '@/features/app/blocks/base/base-side-bar/NodeShareContent';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { tableConfig } from '@/features/i18n/table.config';
import { ShareViewContent } from './ShareViewContent';

interface IUnifiedShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId?: string;
}

const useCurrentNodeFromRoute = () => {
  const baseResource = useBaseResource();
  const { treeItems } = useBaseNodeContext();

  return useMemo(() => {
    let resourceId: string | undefined;
    switch (baseResource.resourceType) {
      case BaseNodeResourceType.Table:
        resourceId = baseResource.tableId;
        break;
      case BaseNodeResourceType.Dashboard:
        resourceId = baseResource.dashboardId;
        break;
      case BaseNodeResourceType.Workflow:
        resourceId = baseResource.workflowId;
        break;
      case BaseNodeResourceType.App:
        resourceId = baseResource.appId;
        break;
      default:
        return null;
    }

    if (!resourceId) return null;

    const entry = Object.entries(treeItems).find(([, item]) => item.resourceId === resourceId);
    if (!entry) return null;

    return { nodeId: entry[0], node: entry[1], resourceType: entry[1].resourceType };
  }, [baseResource, treeItems]);
};

export const UnifiedShareDialog: React.FC<IUnifiedShareDialogProps> = ({
  open,
  onOpenChange,
  nodeId: nodeIdProp,
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const baseId = useBaseId() as string;
  const view = useView();
  const { treeItems } = useBaseNodeContext();
  const routeNode = useCurrentNodeFromRoute();

  const currentNode = useMemo(() => {
    if (nodeIdProp) {
      const node = treeItems[nodeIdProp];
      if (!node) return null;
      return { nodeId: nodeIdProp, node, resourceType: node.resourceType };
    }
    return routeNode;
  }, [nodeIdProp, treeItems, routeNode]);

  const isTable = currentNode?.resourceType === BaseNodeResourceType.Table;
  const isCurrentRouteNode = !nodeIdProp || (routeNode && routeNode.nodeId === nodeIdProp);
  const showViewTab = isTable && !!view && isCurrentRouteNode;

  if (!currentNode) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('table:baseShare.shareTitle')}</DialogTitle>
        </DialogHeader>

        <div className="px-6 pt-6">
          <NodeShareHeader node={currentNode.node} />
        </div>

        {showViewTab ? (
          <Tabs defaultValue="table" className="min-w-0">
            <div className="px-6 pt-3">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="table">{t('table:baseShare.shareTableTab')}</TabsTrigger>
                <TabsTrigger value="view">{t('table:baseShare.shareViewTab')}</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="table" className="mt-0 max-h-[60vh] overflow-y-auto px-6 pb-1">
              <NodeShareContent
                baseId={baseId}
                nodeId={currentNode.nodeId}
                node={currentNode.node}
                hideHeader
              />
            </TabsContent>
            <TabsContent value="view" className="mt-0 max-h-[60vh] overflow-y-auto px-6 pb-1">
              <ShareViewContent />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto px-6 pb-1">
            <NodeShareContent
              baseId={baseId}
              nodeId={currentNode.nodeId}
              node={currentNode.node}
              hideHeader
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
