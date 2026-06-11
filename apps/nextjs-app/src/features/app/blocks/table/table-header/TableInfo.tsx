import { Table2 } from '@teable/icons';
import { BaseNodeResourceType, type IBaseNodeTableResourceMeta } from '@teable/openapi';
import {
  useBaseId,
  useConnection,
  useIsHydrated,
  useLanDayjs,
  useTable,
  useTablePermission,
} from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { cn, Input, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { AppWindowMacIcon, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { EmojiPicker } from '@/features/app/components/emoji/EmojiPicker';
import { tableConfig } from '@/features/i18n/table.config';
import { useBaseNodeContext } from '../../base/base-node/hooks/useBaseNodeContext';
import { useImportStatus } from '../hooks/use-import-status';

interface ITableInfoProps {
  className?: string;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
}

export const TableInfo: React.FC<ITableInfoProps> = (props: ITableInfoProps) => {
  const { className, isEditing: isEditingProp, setIsEditing: setIsEditingProp } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const isControlled = isEditingProp !== undefined;
  const isEditing = isControlled ? isEditingProp : internalIsEditing;
  const setIsEditing = useCallback(
    (isEditing: boolean) => {
      if (isControlled) {
        setIsEditingProp?.(isEditing);
      } else {
        setInternalIsEditing(isEditing);
      }
    },
    [isControlled, setIsEditingProp, setInternalIsEditing]
  );

  const { connected } = useConnection();
  const permission = useTablePermission();
  const table = useTable();
  const baseId = useBaseId() as string;
  const router = useRouter();
  const dayjs = useLanDayjs();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isHydrated = useIsHydrated();
  const { treeItems } = useBaseNodeContext();

  const { loading: isImporting } = useImportStatus(table?.id as string);

  const loginApps = useMemo(() => {
    if (!table?.id) return;

    const tableNode = Object.values(treeItems).find(
      (node) => node.resourceType === BaseNodeResourceType.Table && node.resourceId === table.id
    );

    const meta = tableNode?.resourceMeta as IBaseNodeTableResourceMeta | undefined;
    if (meta?.loginApps?.length) return meta.loginApps;
    if (meta?.loginAppId) return [{ id: meta.loginAppId, name: '' }];
  }, [table?.id, treeItems]);

  const icon = table?.icon ? (
    <Emoji size={'1.25rem'} emoji={table.icon} />
  ) : (
    <Table2 className="size-5" />
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [isEditing]);

  return (
    <div
      className={cn('flex justify-center items-center relative overflow-hidden gap-2', className)}
    >
      {connected && !isImporting ? (
        <EmojiPicker
          className="flex size-5 cursor-pointer items-center justify-center hover:bg-muted-foreground/60"
          onChange={(icon: string) => table?.updateIcon(icon)}
          disabled={!permission['table|update']}
        >
          {icon}
        </EmojiPicker>
      ) : (
        <Spin />
      )}
      <div
        className={cn(
          'relative flex h-8 shrink-0 grow-0 flex-col items-start justify-center gap-1',
          { 'min-w-16': isEditing }
        )}
      >
        {isEditing ? (
          <Input
            ref={inputRef}
            type="text"
            defaultValue={table?.name}
            className="absolute left-0 top-0 size-full cursor-text"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onBlur={(e) => {
              if (e.target.value && e.target.value !== table?.name) {
                table?.updateName(e.target.value);
              }
              setIsEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.currentTarget.value && e.currentTarget.value !== table?.name) {
                  table?.updateName(e.currentTarget.value);
                }
                setIsEditing(false);
              }
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          />
        ) : (
          <div className="flex items-center gap-1.5">
            <div
              className="text-sm leading-none"
              onDoubleClick={() => {
                permission['table|update'] && setIsEditing(true);
              }}
            >
              {table?.name}
            </div>
            {loginApps && loginApps.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded border border-border/80 bg-muted/60 px-1 text-[9px] leading-none text-muted-foreground transition-colors hover:bg-muted"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ShieldCheck className="size-2.5 shrink-0" />
                    <span>{t('table:table.loginUserTable')}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-48 p-1"
                  align="start"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div className="px-2 py-1 text-xs text-muted-foreground">
                    {t('table:table.linkedApps')}
                  </div>
                  {loginApps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                      onClick={() => router.push(`/base/${baseId}/app/${app.id}`)}
                    >
                      <AppWindowMacIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{app.name || app.id}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}
        <div className="hidden text-[11px] leading-3 text-muted-foreground @xl/view-header:block">
          {t('table:lastModify')} {isHydrated ? dayjs(table?.lastModifiedTime).fromNow() : ''}
        </div>
      </div>
    </div>
  );
};
