import type { FieldType, ViewType } from '@teable/core';
import { useBaseId, useFieldStaticGetter } from '@teable/sdk/hooks';
import {
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@teable/ui-lib/shadcn';
import { Bot, Lock, Table2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { VIEW_ICON_MAP } from '@/features/app/blocks/view/constant';
import { useStaticResolver } from '@/features/app/context/StaticTextRegistryProvider';
import { Emoji } from '../../emoji/Emoji';
import type { AffectedItem, AffectedItemType, AffectedTableSource } from './types';

interface AffectedFieldsListProps {
  items: AffectedItem[];
  isMultiField?: boolean;
}

export const AffectedFieldsList = ({ items, isMultiField = false }: AffectedFieldsListProps) => {
  const { t } = useTranslation(['common', 'table']);
  const fieldStaticGetter = useFieldStaticGetter();
  const getWorkflowIcon = useStaticResolver('workflow', 'getWorkflowIcon') as (
    type: string
  ) => React.FC<React.SVGProps<SVGSVGElement>>;
  const getWorkflowNodeTypeName = useStaticResolver('workflow', 'getNodeTypeName') as (
    type?: string,
    name?: string
  ) => string;
  const baseId = useBaseId();

  const getTypeLabel = (itemType: AffectedItemType) => {
    switch (itemType) {
      case 'field':
        return String(t('common:noun.field'));
      case 'view':
        return t('common:noun.view');
      case 'workflow':
        return t('common:noun.automation');
      case 'authorityMatrix':
        return t('common:noun.authorityMatrix');
      default:
        return '-';
    }
  };

  const getItemDisplayName = (item: AffectedItem) => {
    if (item.itemType !== 'workflow') {
      return item.name;
    }

    return getWorkflowNodeTypeName(item.type, item.name);
  };

  const getIcon = (item: AffectedItem) => {
    if (item.itemType === 'field' && item.type) {
      return fieldStaticGetter(item.type as FieldType).Icon;
    }
    if (item.itemType === 'workflow') {
      return getWorkflowIcon(item.type as string);
    }
    if (item.itemType === 'view' && item.type) {
      return VIEW_ICON_MAP[item.type as ViewType];
    }
    if (item.itemType === 'authorityMatrix') {
      return Lock;
    }
    return null;
  };

  const getResourceIcon = (item: AffectedItem) => {
    if (item.itemType === 'workflow') {
      return <Bot className="size-4 shrink-0 text-muted-foreground" />;
    }
    if (item.itemType === 'view' || item.itemType === 'field') {
      const source = item.source as AffectedTableSource;
      return source?.icon ? (
        <Emoji emoji={source.icon} size="0.875rem" className="size-4 shrink-0" />
      ) : (
        <Table2 className="size-4 shrink-0 text-muted-foreground" />
      );
    }
    return null;
  };

  return (
    <div className="min-h-0 overflow-y-auto rounded-md border">
      <Table className="table-fixed">
        <TableHeader className="sticky top-0">
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead className="h-9 truncate px-4 text-xs">
              {t('table:field.editor.deleteField.affectedItems')}
            </TableHead>
            <TableHead
              className={cn('h-9 w-[120px] truncate px-4 text-xs', {
                'w-48': isMultiField,
              })}
            >
              {t('table:field.editor.deleteField.type')}
            </TableHead>
            <TableHead
              className={cn('h-9 w-[180px] truncate px-4 text-xs', {
                'w-48': isMultiField,
              })}
            >
              {t('table:field.editor.deleteField.source')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const Icon = getIcon(item);
            const displayName = getItemDisplayName(item);

            return (
              <TableRow key={`${item.itemType}-${item.id}`} className="hover:bg-transparent">
                <TableCell className="truncate px-4 py-2 text-foreground">
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className="size-4 shrink-0" />}
                    <span className="truncate" title={displayName}>
                      {displayName}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="truncate px-4 py-2 text-foreground">
                  {getTypeLabel(item.itemType)}
                </TableCell>
                <TableCell className="truncate px-4 py-2 text-foreground">
                  {item.source ? (
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        {getResourceIcon(item)}
                        <span className="truncate">{item.source.name}</span>
                      </div>
                      {baseId !== item.source.base.id && (
                        <span className="w-fit max-w-full truncate rounded-sm border bg-muted px-2 text-xs text-muted-foreground">
                          {item.source.base.name}
                        </span>
                      )}
                    </div>
                  ) : (
                    '-'
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
