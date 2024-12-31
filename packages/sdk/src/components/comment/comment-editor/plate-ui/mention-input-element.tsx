import { useQuery } from '@tanstack/react-query';
import type { UserCollaboratorItem } from '@teable/openapi';
import { getBaseCollaboratorList, PrincipalType } from '@teable/openapi';
import { cn, withRef } from '@udecode/cn';
import { PlateElement } from '@udecode/plate-common/react';
import { getMentionOnSelectItem } from '@udecode/plate-mention';
import React, { useState } from 'react';
import { ReactQueryKeys } from '../../../../config';
import { useTranslation } from '../../../../context/app/i18n';
import { useSession } from '../../../../hooks';
import { UserAvatar } from '../../../cell-value';
import { useBaseId } from '../../hooks';
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

const onSelectItem = getMentionOnSelectItem<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  text: any;
}>();

export const MentionInputElement = withRef<typeof PlateElement>(({ className, ...props }, ref) => {
  const { children, editor, element } = props;
  const { t } = useTranslation();
  const { user } = useSession();
  const [search, setSearch] = useState('');
  const baseId = useBaseId();

  const { data: collaboratorsData } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId!, {
      search,
      type: PrincipalType.User,
      take: 100,
      skip: 0,
    }),
    queryFn: ({ queryKey }) =>
      getBaseCollaboratorList(queryKey[1], { search, type: PrincipalType.User }).then(
        (res) => res.data
      ),
    enabled: !!baseId,
  });

  const mentionUsers = (collaboratorsData?.collaborators as UserCollaboratorItem[])?.filter(
    (item) => item.userId !== user.id
  );

  return (
    <PlateElement
      as="span"
      data-slate-value={element.value}
      ref={ref}
      {...props}
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    >
      <InlineCombobox
        element={element}
        setValue={setSearch}
        showTrigger={false}
        trigger="@"
        value={search}
      >
        <span
          className={cn(
            'inline-block rounded-md bg-slate-100 px-1.5 py-0 align-baseline text-sm ring-slate-950 focus-within:ring-2 dark:bg-slate-800 dark:ring-slate-300',
            className
          )}
        >
          <InlineComboboxInput />
        </span>

        <InlineComboboxContent className="my-1.5">
          <InlineComboboxEmpty>{t('common.search.empty')}</InlineComboboxEmpty>

          {mentionUsers?.map((item) => (
            <InlineComboboxItem
              key={item.userId}
              onClick={() =>
                onSelectItem(
                  editor,
                  {
                    text: {
                      id: item.userId,
                      name: item.userName,
                      avatar: item.avatar ?? undefined,
                    },
                  },
                  search
                )
              }
              value={item.userName}
            >
              <UserAvatar avatar={item.avatar} name={item.userName} />
              <span className="pl-1">{item.userName}</span>
            </InlineComboboxItem>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>

      {children}
    </PlateElement>
  );
});
