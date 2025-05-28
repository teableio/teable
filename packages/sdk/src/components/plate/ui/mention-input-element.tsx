'use client';

import { useQuery } from '@tanstack/react-query';
import { getUserCollaborators } from '@teable/openapi';
import type { PlateElementProps } from '@udecode/plate/react';
import { PlateElement } from '@udecode/plate/react';
import type { TMentionInputElement } from '@udecode/plate-mention';

import { getMentionOnSelectItem } from '@udecode/plate-mention';
import * as React from 'react';

import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useBaseId, useSession } from '../../../hooks';
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

export function MentionInputElement(props: PlateElementProps<TMentionInputElement>) {
  const { editor, element } = props;
  const [search, setSearch] = React.useState('');
  const baseId = useBaseId();
  const { user } = useSession();
  const { t } = useTranslation();
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

  return (
    <PlateElement {...props} as="span" data-slate-value={element.value}>
      <InlineCombobox
        value={search}
        element={element}
        setValue={setSearch}
        showTrigger={false}
        trigger="@"
      >
        <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm ring-ring focus-within:ring-2">
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
