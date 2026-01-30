import { useInfiniteQuery } from '@tanstack/react-query';
import { Database, Search, Table2 } from '@teable/icons';
import { type ISpaceSearchItem } from '@teable/openapi';
import { spaceSearch } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  Button,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@teable/ui-lib/shadcn';
import { debounce } from 'lodash';
import { AppWindowMacIcon, BotIcon, CircleGaugeIcon } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useMemo, useCallback, useRef, type FC } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';
import { spaceConfig } from '@/features/i18n/space.config';
import { getNodeUrl } from '../../base/base-node/hooks';

interface Props {
  spaceId: string;
}

const SearchTypeIconMap = {
  base: Database,
  table: Table2,
  dashboard: CircleGaugeIcon,
  workflow: BotIcon,
  app: AppWindowMacIcon,
};

export const SpaceQuickSearch: FC<Props> = ({ spaceId }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const isComposingRef = useRef(false);
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const modKeyStr = useModKeyStr();
  const debouncedSetSearch = useMemo(
    () =>
      debounce((value: string) => {
        setDebouncedSearch(value);
      }, 300),
    []
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      // Only trigger debounced search when not composing (e.g., during IME input)
      if (!isComposingRef.current) {
        debouncedSetSearch(value);
      }
    },
    [debouncedSetSearch]
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = false;
      // Trigger search with the final composed value
      debouncedSetSearch(e.currentTarget.value);
    },
    [debouncedSetSearch]
  );

  useHotkeys(
    'mod+k',
    () => {
      setOpen(!open);
    },
    {
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['space-search', spaceId, debouncedSearch],
    queryFn: ({ pageParam }) =>
      spaceSearch(spaceId, {
        search: debouncedSearch,
        pageSize: 10,
        cursor: pageParam,
      }).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: open && debouncedSearch.length > 0,
  });

  const allResults = useMemo(() => data?.pages?.flatMap((page) => page.list) ?? [], [data]);

  const navigateTo = (item: ISpaceSearchItem) => {
    setOpen(false);
    setSearch('');
    setDebouncedSearch('');

    const { type, id, baseId } = item;

    const url = getNodeUrl({
      baseId,
      resourceType: type,
      resourceId: id,
    });
    if (url) {
      router.push(url);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setSearch('');
      setDebouncedSearch('');
    }
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="w-6 shrink-0 px-0"
              variant="ghost"
              size="xs"
              onClick={() => setOpen(true)}
            >
              <Search className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent hideWhenDetached={true}>
            {t('common:quickAction.title')}
            <span>{modKeyStr}+K</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <CommandDialog
        closeable={false}
        open={open}
        onOpenChange={handleOpenChange}
        commandProps={{
          filter: () => 1,
          shouldFilter: false,
        }}
      >
        <CommandInput
          placeholder={t('common:quickAction.placeHolder')}
          value={search}
          onValueChange={handleSearchChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
        <CommandList>
          {debouncedSearch.length > 0 && !isLoading && allResults.length === 0 && (
            <CommandEmpty>{t('common:noResult')}</CommandEmpty>
          )}

          {allResults.map((item) => {
            const IconComponent = SearchTypeIconMap[item.type as keyof typeof SearchTypeIconMap];
            return (
              <div className="px-2" key={`${item.type}-${item.id}`}>
                <CommandItem
                  className="flex flex-col items-start gap-1"
                  value={`${item.type}-${item.id}`}
                  onSelect={() => navigateTo(item)}
                >
                  <div className="flex w-full items-center gap-2">
                    <div className="flex size-4 shrink-0 items-center justify-center">
                      {item.icon ? (
                        <Emoji emoji={item.icon} size="1em" />
                      ) : IconComponent ? (
                        <IconComponent className="size-full" />
                      ) : null}
                    </div>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="flex w-full items-center gap-2 pl-6 text-xs text-muted-foreground">
                    {item.createdUser && (
                      <div className="flex shrink-0 items-center gap-1">
                        <span>{t('space:baseList.owner')}:</span>
                        <UserAvatar user={item.createdUser} className="size-4 border" />
                        <span className="truncate">{item.createdUser.name}</span>
                      </div>
                    )}
                    {item.type !== 'base' && (
                      <>
                        {item.createdUser && <span>·</span>}
                        <span className="truncate">{item.baseName}</span>
                      </>
                    )}
                  </div>
                </CommandItem>
              </div>
            );
          })}

          {hasNextPage && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {t('common:actions.loadMore')}
                {isFetchingNextPage && <Spin className="ml-2 size-4" />}
              </Button>
            </div>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
};
