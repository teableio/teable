import { verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableHandle } from '@teable/icons';
import { BaseNodeResourceType } from '@teable/openapi';
import { useTablePermission, useViewId } from '@teable/sdk/hooks';
import {
  Popover,
  PopoverTrigger,
  Button,
  PopoverContent,
  CommandInput,
  CommandEmpty,
  CommandList,
  CommandItem,
  Command,
} from '@teable/ui-lib/shadcn';
import { List } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { useBaseResource, type IBaseResourceTable } from '../../../hooks/useBaseResource';
import { getNodeUrl } from '../../base/base-node/hooks';
import { VIEW_ICON_MAP } from '../constant';
import { DraggableWrapper } from './DraggableWrapper';

export const ExpandViewList = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);
  const [isDraggable, setIsDraggable] = useState(true);
  const [highlightedValue, setHighlightedValue] = useState<string | undefined>();
  const router = useRouter();
  const permission = useTablePermission();
  const { baseId, tableId } = useBaseResource() as IBaseResourceTable;
  const curViewId = useViewId();

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setHighlightedValue(curViewId);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button className="size-7 shrink-0 px-0" size="xs" variant="ghost">
          <List className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto max-w-[456px] p-1">
        <Command
          value={highlightedValue}
          onValueChange={setHighlightedValue}
          filter={(value, search, keywords) => {
            const searchLower = search.toLowerCase();
            if (keywords?.some((keyword) => keyword.toLowerCase().includes(searchLower))) {
              return 1;
            }
            return 0;
          }}
        >
          <CommandInput
            className="h-9"
            placeholder={t('table:view.searchView')}
            onValueChange={(value) => setIsDraggable(!value)}
          />
          <CommandEmpty>{t('common:noResult')}</CommandEmpty>
          <CommandList className="max-h-[70vh] p-0.5">
            <DraggableWrapper strategy={verticalListSortingStrategy}>
              {({
                view: { id, name, type },
                setNodeRef,
                attributes,
                listeners,
                style,
                isDragging,
              }) => {
                const Icon = VIEW_ICON_MAP[type];

                return (
                  <CommandItem
                    key={id}
                    value={id}
                    keywords={[name]}
                    ref={setNodeRef}
                    style={{
                      ...style,
                      opacity: isDragging ? '0.6' : '1',
                    }}
                    onSelect={() => {
                      const url = getNodeUrl({
                        baseId,
                        resourceType: BaseNodeResourceType.Table,
                        resourceId: tableId,
                        viewId: id,
                      });
                      if (url) {
                        router.push(url, undefined, { shallow: true });
                      }
                      setOpen(false);
                    }}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="ml-2 truncate text-sm" title={name}>
                      {name}
                    </span>
                    <span className="grow" />
                    {isDraggable && permission['view|update'] && (
                      <div {...attributes} {...listeners} className="pr-1">
                        <DraggableHandle className="size-3 shrink-0" />
                      </div>
                    )}
                  </CommandItem>
                );
              }}
            </DraggableWrapper>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
