import { DragHandleDots2Icon } from '@radix-ui/react-icons';
import { Copy, Edit, Maximize2, MoreHorizontal, X } from '@teable/icons';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { MenuDeleteItem } from '@/features/app/components/MenuDeleteItem';

export const PluginHeader = (props: {
  name: string;
  draggableHandleClassName: string;
  isExpanded?: boolean;
  canManage?: boolean;
  dragging?: boolean;
  onClose: () => void;
  onDelete: () => void;
  onExpand: () => void;
  onCopy: () => void;
  onNameChange: (name: string) => void;
}) => {
  const {
    name,
    dragging,
    canManage,
    isExpanded,
    draggableHandleClassName,
    onClose,
    onDelete,
    onExpand,
    onCopy,
    onNameChange,
  } = props;
  const [rename, setRename] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useTranslation(['common']);

  if (isExpanded) {
    return (
      <div className="flex h-10 items-center border-b pl-4 pr-2">
        <div className=" flex-1 truncate">{name}</div>
        <Button variant={'ghost'} size={'xs'} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 px-1">
      <DragHandleDots2Icon
        className={cn(
          'size-4 text-gray-500 cursor-pointer opacity-0 group-hover:opacity-100',
          {
            'pointer-events-none !opacity-0': !canManage,
          },
          {
            'opacity-100': dragging,
          },
          draggableHandleClassName
        )}
      />
      <div className="relative flex h-full flex-1 items-center overflow-hidden px-0.5">
        <span className="truncate text-sm">{name}</span>
        <Input
          ref={renameRef}
          style={{ width: 'calc(100% - 0.25rem)' }}
          className={cn('absolute h-6 hidden', {
            block: rename !== null,
          })}
          value={rename || ''}
          onBlur={() => {
            if (rename && rename !== name) {
              onNameChange(rename);
            }
            setRename(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.currentTarget.blur();
            }
          }}
          onChange={(e) => setRename(e.target.value)}
        />
      </div>
      <div
        className={cn('flex gap-1 group-hover:w-auto', {
          'w-0': !menuOpen,
        })}
      >
        <Button
          title={t('common:actions.expand')}
          className="h-5 w-auto p-2"
          size={'xs'}
          variant={'ghost'}
          onClick={onExpand}
        >
          <Maximize2 />
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button className="h-5 w-auto p-2" variant={'ghost'} size={'xs'}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="relative min-w-36 overflow-hidden">
            {canManage && (
              <DropdownMenuItem
                onSelect={() => {
                  setRename(name);
                  setTimeout(() => renameRef.current?.focus(), 200);
                }}
              >
                <Edit className="mr-1.5" />
                {t('common:actions.rename')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onExpand}>
              <Maximize2 className="mr-1.5" />
              {t('common:actions.expand')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopy}>
              <Copy className="mr-1.5" />
              {t('common:actions.duplicate')}
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <MenuDeleteItem onConfirm={onDelete} />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
