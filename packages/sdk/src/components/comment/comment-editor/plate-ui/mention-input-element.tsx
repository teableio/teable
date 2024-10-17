import { cn, withRef } from '@udecode/cn';
import { PlateElement } from '@udecode/plate-common/react';
import { getMentionOnSelectItem } from '@udecode/plate-mention';
import React, { useState } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useSession } from '../../../../hooks';
import { UserAvatar } from '../../../cell-value';
import { useCollaborators } from '../../hooks';
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

const onSelectItem = getMentionOnSelectItem();

export const MentionInputElement = withRef<typeof PlateElement>(({ className, ...props }, ref) => {
  const { children, editor, element } = props;
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const { user } = useSession();
  const collaborators = useCollaborators();
  const mentionUsers = collaborators.filter((item) => item.userId !== user.id);

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

          {mentionUsers.map((item) => (
            <InlineComboboxItem
              key={item.userId}
              onClick={() =>
                onSelectItem(
                  editor,
                  {
                    text: item.userId,
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
