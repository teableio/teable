'use client';

import { ChevronDown } from '@teable/icons';
import type { IBaseNodeVo } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName } from '../../../base/base-node/hooks';
import { useBaseNodeContext } from '../../../base/base-node/hooks/useBaseNodeContext';

interface INodeSelectProps {
  value?: string;
  onChange?: (nodeId: string) => void;
  placeholder?: string;
  /** List of node IDs (from NodeTreeSelect's selected items) */
  nodeIds?: string[];
  className?: string;
  disabled?: boolean;
}

export const NodeSelect = (props: INodeSelectProps) => {
  const { value, onChange, placeholder, nodeIds, className, disabled = false } = props;
  const { t } = useTranslation(['common']);
  const { treeItems } = useBaseNodeContext();

  // Get nodes based on node ID list and filter out folder type nodes
  const availableNodes = useMemo(() => {
    if (!nodeIds || nodeIds.length === 0) {
      return [];
    }

    return nodeIds
      .map((nodeId) => {
        const node = treeItems[nodeId];
        // Only return node if it's not a folder, otherwise return undefined
        if (node && node.resourceType !== BaseNodeResourceType.Folder) {
          return node as unknown as IBaseNodeVo;
        }
        return undefined;
      })
      .filter((node): node is IBaseNodeVo => node !== undefined);
  }, [nodeIds, treeItems]);

  // Render node icon
  const renderNodeIcon = (node: IBaseNodeVo) => {
    const IconComponent = BaseNodeResourceIconMap[node.resourceType];
    const icon = getNodeIcon(node);

    if (node.resourceType === BaseNodeResourceType.Table && icon) {
      return <Emoji emoji={icon} size={16} className="size-4 shrink-0" />;
    }

    return <IconComponent className="size-4 shrink-0" />;
  };

  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={disabled || availableNodes.length === 0}
    >
      <SelectTrigger className={cn(className, '[&_svg:last-child]:hidden')}>
        <SelectValue placeholder={placeholder || t('common:actions.select')} />
        <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
      </SelectTrigger>
      <SelectContent>
        {availableNodes.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t('common:noResult')}
          </div>
        ) : (
          availableNodes.map((node) => (
            <SelectItem key={node.id} value={node.id}>
              <div className="flex items-center gap-2">
                {renderNodeIcon(node)}
                <span className="truncate">{getNodeName(node)}</span>
              </div>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
};
