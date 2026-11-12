import { AlertCircle, ChevronDown, Trash } from '@teable/icons';
import {
  BaseNodeResourceType,
  type IImportBasePreviewNode,
  type IImportBasePreviewVo,
} from '@teable/openapi';
import { Spin } from '@teable/ui-lib/index';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { filesize } from 'filesize';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { BaseNodeResourceIconMap } from '@/features/app/blocks/base/base-node/hooks/helper';
import { spaceConfig } from '@/features/i18n/space.config';

export type IImportPreviewStatus = 'loading' | 'ready' | 'invalid' | 'failed';

interface IImportPreviewCardProps {
  status: IImportPreviewStatus;
  preview?: IImportBasePreviewVo;
  /** Server detail for an invalid file, e.g. which part of the archive is broken. */
  errorDetail?: string;
  /** The uploaded file: once its contents are listed, this card replaces the file tile. */
  file?: File | null;
  onRemove?: () => void;
}

// Display order: data first, then what is built on top of it.
const GROUP_ORDER = [
  BaseNodeResourceType.Table,
  BaseNodeResourceType.App,
  BaseNodeResourceType.Workflow,
  BaseNodeResourceType.Routine,
  BaseNodeResourceType.Dashboard,
];

export const ImportPreviewCard = (props: IImportPreviewCardProps) => {
  const { status, preview, errorDetail, file, onRemove } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const typeLabels: Record<BaseNodeResourceType, string> = {
    [BaseNodeResourceType.Table]: t('common:noun.table'),
    [BaseNodeResourceType.App]: t('common:noun.app'),
    [BaseNodeResourceType.Workflow]: t('common:noun.automation'),
    [BaseNodeResourceType.Routine]: t('common:noun.routine'),
    [BaseNodeResourceType.Dashboard]: t('common:noun.dashboard'),
    [BaseNodeResourceType.Folder]: t('common:noun.folder'),
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
        <Spin className="size-4" />
        <span>{t('space:import.preview.analyzing')}</span>
      </div>
    );
  }

  if (status === 'invalid' || status === 'failed') {
    const invalid = status === 'invalid';
    return (
      <div
        className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', {
          'border-destructive/50 text-destructive': invalid,
          'text-amber-600': !invalid,
        })}
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div>{t(invalid ? 'space:import.preview.invalid' : 'space:import.preview.failed')}</div>
          {invalid && errorDetail && <div className="break-all opacity-80">{errorDetail}</div>}
        </div>
      </div>
    );
  }

  if (!preview) return null;

  // Folders are containers, already visible in the tree: they are neither counted nor totalled.
  const groups = preview.groups
    .filter((group) => group.type !== BaseNodeResourceType.Folder)
    .sort((a, b) => GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type));
  const total = groups.reduce((sum, group) => sum + group.count, 0);

  return (
    <div className="text-sm">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-base font-medium">
          {preview.name || t('common:untitled')}
        </span>
        <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
          {groups.map(({ type, count }) => {
            const Icon = BaseNodeResourceIconMap[type];
            return (
              // Same icons as the tree below, so the count needs no text label.
              <span
                key={type}
                className="flex items-center gap-1.5"
                title={typeLabels[type]}
                aria-label={`${typeLabels[type]} ${count}`}
                data-testid={`import-preview-${type}`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="font-medium text-foreground">{count}</span>
              </span>
            );
          })}
          {groups.length > 0 && <span className="h-3.5 w-px bg-border" />}
          <span>{t('space:import.preview.total', { count: total })}</span>
          {file && (
            <>
              <span className="h-3.5 w-px bg-border" />
              <span>{filesize(file.size)}</span>
            </>
          )}
        </div>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={t('common:actions.delete')}
            onClick={onRemove}
          >
            <Trash className="size-4 text-muted-foreground" />
          </Button>
        )}
      </div>
      {preview.nodes.length > 0 && <ImportPreviewTree nodes={preview.nodes} />}
    </div>
  );
};

/** The nodes as the sidebar will show them after the import: folders first-class, children indented. */
const ImportPreviewTree = ({ nodes }: { nodes: IImportBasePreviewNode[] }) => {
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const childrenOf = React.useMemo(() => {
    const childrenOf = new Map<string | null, IImportBasePreviewNode[]>();
    for (const node of nodes) {
      const siblings = childrenOf.get(node.parentId);
      if (siblings) siblings.push(node);
      else childrenOf.set(node.parentId, [node]);
    }
    return childrenOf;
  }, [nodes]);

  // Folders start closed, as an overview; the counts in the header give the scale.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set(nodes.filter((node) => childrenOf.has(node.id)).map((node) => node.id))
  );

  const rows: { node: IImportBasePreviewNode; depth: number }[] = [];
  const collect = (parentId: string | null, depth: number) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      rows.push({ node, depth });
      if (!collapsed.has(node.id)) collect(node.id, depth + 1);
    }
  };
  collect(null, 0);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <ul
      className="mt-3 max-h-80 space-y-0.5 overflow-y-auto border-t pt-2"
      data-testid="import-preview-tree"
    >
      {rows.map(({ node, depth }) => {
        const Icon = BaseNodeResourceIconMap[node.type];
        const name = node.name || t('common:untitled');
        const hasChildren = childrenOf.has(node.id);
        const row = (
          <>
            {/* Leaves keep the chevron's slot empty so every icon lines up. */}
            {hasChildren ? (
              <ChevronDown
                className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', {
                  '-rotate-90 rtl:rotate-90': collapsed.has(node.id),
                })}
              />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate" title={name}>
              {name}
            </span>
          </>
        );
        return (
          <li key={node.id} style={{ paddingInlineStart: depth * 20 }}>
            {hasChildren ? (
              <button
                type="button"
                aria-expanded={!collapsed.has(node.id)}
                onClick={() => toggle(node.id)}
                className="flex w-full items-center gap-2 rounded-sm py-1 text-start hover:bg-muted"
              >
                {row}
              </button>
            ) : (
              <div className="flex items-center gap-2 py-1">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
