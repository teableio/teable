'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from '@teable/icons';
import { getUserCollaborators } from '@teable/openapi';
import { cn, Input, Sheet, SheetContent } from '@teable/ui-lib';
import type { PlateElementProps } from '@udecode/plate/react';
import { PlateElement } from '@udecode/plate/react';
import type { TMentionInputElement } from '@udecode/plate-mention';

import { getMentionOnSelectItem } from '@udecode/plate-mention';
import * as React from 'react';

import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useBaseId, useIsTouchDevice, useSession } from '../../../hooks';
import { UserAvatar } from '../../cell-value';
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const onSelectItem = getMentionOnSelectItem<{ text: any; key: string }>();

function MobileMentionSheet({
  editor,
  element,
  mentionUsers,
  search,
  setSearch,
}: {
  editor: PlateElementProps<TMentionInputElement>['editor'];
  element: TMentionInputElement;
  mentionUsers: { id: string; name: string; avatar?: string | null }[] | undefined;
  search: string;
  setSearch: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(true);

  const handleSelect = React.useCallback(
    (item: { id: string; name: string; avatar?: string | null }) => {
      // 1. Find and remove the mention_input node first
      const path = editor.api.findPath(element);
      if (path) {
        editor.tf.removeNodes({ at: path });
        // Set selection to where the mention_input was
        editor.tf.select(path);
      }

      // 2. Now insert the mention node at the correct position
      onSelectItem(
        editor,
        {
          key: item.id,
          text: {
            id: item.id,
            name: item.name,
            avatar: item.avatar ?? undefined,
          },
        },
        search
      );
      setOpen(false);
    },
    [editor, element, search]
  );

  const handleClose = React.useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setOpen(false);
        // Remove the mention input node when sheet is dismissed without selection
        const path = editor.api.findPath(element);
        if (path) {
          editor.tf.removeNodes({ at: path });
          editor.tf.focus();
        }
      }
    },
    [editor, element]
  );

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="bottom"
        className="flex h-[50vh] flex-col rounded-t-lg p-0"
        closeable={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            className="h-8 border-none shadow-none focus-visible:ring-0"
            placeholder={t('common.search.placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {mentionUsers && mentionUsers.length > 0 ? (
            mentionUsers.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5',
                  'active:bg-accent transition-colors'
                )}
                onClick={() => handleSelect(item)}
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
}

export function MentionInputElement(props: PlateElementProps<TMentionInputElement>) {
  const { editor, element } = props;
  const [search, setSearch] = React.useState('');
  const baseId = useBaseId();
  const { user } = useSession();
  const { t } = useTranslation();
  const isTouchDevice = useIsTouchDevice();

  const { data: collaboratorsData } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorListUser(baseId!, {
      search,
      take: 100,
      skip: 0,
    }),
    queryFn: ({ queryKey }) =>
      getUserCollaborators(queryKey[1], { search }).then((res) => res.data),
    enabled: !!baseId,
  });

  const mentionUsers = collaboratorsData?.users?.filter((item) => item.id !== user.id);

  // Mobile: use bottom Sheet
  if (isTouchDevice) {
    return (
      <PlateElement {...props} as="span" data-slate-value={element.value}>
        <span className="inline align-baseline text-sm font-medium text-primary">@</span>
        <MobileMentionSheet
          editor={editor}
          element={element}
          mentionUsers={mentionUsers}
          search={search}
          setSearch={setSearch}
        />
        {props.children}
      </PlateElement>
    );
  }

  // Desktop: use InlineCombobox popover
  return (
    <PlateElement {...props} as="span" data-slate-value={element.value}>
      <InlineCombobox
        value={search}
        element={element}
        setValue={setSearch}
        showTrigger={true}
        trigger="@"
      >
        <span className="inline align-baseline text-sm font-medium text-primary">
          <InlineComboboxInput />
        </span>

        <InlineComboboxContent className="my-1.5">
          <InlineComboboxEmpty>{t('common.search.empty')}</InlineComboboxEmpty>

          <InlineComboboxGroup>
            {mentionUsers?.map((item) => (
              <InlineComboboxItem
                key={item.id}
                onClick={() => {
                  onSelectItem(
                    editor,
                    {
                      key: item.id,
                      // why do this, causing the mention select only write the text to node
                      text: {
                        id: item.id,
                        name: item.name,
                        avatar: item.avatar ?? undefined,
                      },
                    },
                    search
                  );
                }}
                value={item.name}
              >
                <UserAvatar avatar={item.avatar} name={item.name} />
                <span className="pl-1">{item.name}</span>
              </InlineComboboxItem>
            ))}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
