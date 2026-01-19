import { Table2 } from '@teable/icons';
import {
  useConnection,
  useTable,
  useTablePermission,
  useLanDayjs,
  useIsHydrated,
} from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { cn, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { EmojiPicker } from '@/features/app/components/emoji/EmojiPicker';
import { tableConfig } from '@/features/i18n/table.config';
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
  const dayjs = useLanDayjs();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isHydrated = useIsHydrated();

  const { loading: isImporting } = useImportStatus(table?.id as string);

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
            style={{
              boxShadow: 'none',
            }}
            className="round-none absolute left-0 top-0 size-full cursor-text px-2 text-sm shadow-none outline-none"
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
          <div
            className="text-sm leading-none"
            onDoubleClick={() => {
              permission['table|update'] && setIsEditing(true);
            }}
          >
            {table?.name}
          </div>
        )}
        <div className="hidden text-[11px] leading-3 text-muted-foreground @xl/view-header:block">
          {t('table:lastModify')} {isHydrated ? dayjs(table?.lastModifiedTime).fromNow() : ''}
        </div>
      </div>
    </div>
  );
};
