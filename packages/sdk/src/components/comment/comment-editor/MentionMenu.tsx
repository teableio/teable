import { useQuery } from '@tanstack/react-query';
import { Search } from '@teable/icons';
import { getUserCollaborators } from '@teable/openapi';
import { cn, Input, Sheet, SheetContent } from '@teable/ui-lib';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useBaseId, useSession } from '../../../hooks';
import { UserAvatar } from '../../cell-value';
import type { IMentionItem } from './extensions/mention';

const useMentionUsers = (search: string) => {
  const baseId = useBaseId();
  const { user } = useSession();
  const { data } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorListUser(baseId!, { search, take: 100, skip: 0 }),
    queryFn: ({ queryKey }) =>
      getUserCollaborators(queryKey[1], { search }).then((res) => res.data),
    enabled: !!baseId,
  });
  return data?.users?.filter((item) => item.id !== user.id);
};

export interface IMentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface IMentionListProps {
  query: string;
  onSelect: (item: IMentionItem) => void;
}

export const MentionList = forwardRef<IMentionListHandle, IMentionListProps>((props, ref) => {
  const { query, onSelect } = props;
  const { t } = useTranslation();
  const users = useMentionUsers(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const count = users?.length ?? 0;

  useEffect(() => setActiveIndex(0), [query, count]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      // Enter picks, never sends or breaks the line while the list is open
      if (event.key === 'Enter' || event.key === 'Tab') {
        const user = users?.[activeIndex];
        if (user) onSelect(user);
        return true;
      }
      if (!count) return false;
      if (event.key === 'ArrowDown') {
        setActiveIndex((index) => (index + 1) % count);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActiveIndex((index) => (index - 1 + count) % count);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={listRef}
      role="presentation"
      className="max-h-64 w-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      // keep the caret in the editor while picking
      onMouseDown={(e) => e.preventDefault()}
    >
      {users && !count && (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('common.search.empty')}</div>
      )}
      {users?.map((item, index) => (
        <button
          key={item.id}
          type="button"
          data-index={index}
          className={cn(
            'flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-start text-sm',
            index === activeIndex && 'bg-accent text-accent-foreground'
          )}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => onSelect(item)}
        >
          <UserAvatar avatar={item.avatar} name={item.name} />
          <span className="truncate ps-1">{item.name}</span>
        </button>
      ))}
    </div>
  );
});

MentionList.displayName = 'MentionList';

interface IMentionSheetProps {
  onSelect: (item: IMentionItem) => void;
  onDismiss: () => void;
}

export const MentionSheet = (props: IMentionSheetProps) => {
  const { onSelect, onDismiss } = props;
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const users = useMentionUsers(search);

  return (
    <Sheet open onOpenChange={(open) => !open && onDismiss()}>
      <SheetContent
        side="bottom"
        className="flex h-[50vh] flex-col rounded-t-lg p-0"
        closeable={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            className="border-none"
            placeholder={t('common.search.placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {users?.length ? (
            users.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-2.5 transition-colors active:bg-accent"
                onClick={() => onSelect(item)}
              >
                <UserAvatar avatar={item.avatar} name={item.name} className="size-8" />
                <span className="text-sm">{item.name}</span>
              </button>
            ))
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t('common.search.empty')}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
