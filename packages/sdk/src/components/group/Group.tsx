import type { IGroup } from '@teable/core';
import { LayoutList } from '@teable/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import React, { useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { SortContent } from '../sort/SortContent';

interface IGroupProps {
  group: IGroup | null;
  children: (text: string, isActive: boolean) => React.ReactElement;
  onChange: (group: IGroup | null) => void;
}

export const Group = (props: IGroupProps) => {
  const { children, onChange, group } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const groupLength = group?.length;

  const { text, isActive } = useMemo(() => {
    const text = groupLength
      ? `Group By ${groupLength} field${groupLength > 1 ? 's' : ''}`
      : 'Group';
    return {
      text,
      isActive: text !== 'Group',
      Icon: LayoutList,
    };
  }, [groupLength]);

  const onChangeInner = (group?: IGroup | null) => {
    onChange?.(group?.length ? group : null);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children?.(text, isActive)}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-fit max-w-screen-md p-0">
        <header className="mx-3">
          <div className="border-b py-3 text-xs">{t('group.title')}</div>
        </header>
        <SortContent
          limit={3}
          sortValues={group ?? undefined}
          addBtnText={t('group.addButton')}
          onChange={onChangeInner}
        />
      </PopoverContent>
    </Popover>
  );
};
