import type { IGroup } from '@teable/core';
import { LayoutList } from '@teable/icons';
import React, { useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { AdaptivePanel, useIsDrawerPanel } from '../adaptive-panel';
import { ReadOnlyTip } from '../ReadOnlyTip';
import { SortContent } from '../sort/SortContent';

const GROUP_LIMIT = 3;

interface IGroupProps {
  group: IGroup | null;
  children: (text: string, isActive: boolean) => React.ReactElement;
  onChange: (group: IGroup | null) => void;
  /** Render as a bottom drawer on narrow viewports. Toolbar call sites only. */
  responsive?: boolean;
}

export const Group = (props: IGroupProps) => {
  const { children, onChange, group, responsive } = props;
  const { t, tPlural } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const isDrawer = useIsDrawerPanel(responsive);

  const groupLength = group?.length;

  const { text, isActive } = useMemo(() => {
    const text = groupLength ? tPlural('group.displayLabel', groupLength) : t('group.label');
    return {
      text,
      isActive: text !== t('group.label'),
      Icon: LayoutList,
    };
  }, [groupLength, t, tPlural]);

  const onChangeInner = (group?: IGroup | null) => {
    onChange?.(group?.length ? group : null);
  };

  const hasGroups = Boolean(groupLength);

  return (
    <AdaptivePanel
      responsive={responsive}
      open={isOpen}
      onOpenChange={setIsOpen}
      title={t('group.setTips')}
      popoverClassName="relative w-fit max-w-screen-md overflow-hidden rounded-lg p-0"
      drawerSize={hasGroups ? 'auto' : 'list'}
      bodyClassName={hasGroups ? undefined : 'overflow-hidden'}
      overlay={<ReadOnlyTip />}
      content={
        <>
          {!isDrawer && <div className="px-4 pt-3 text-[13px]">{t('group.setTips')}</div>}
          <SortContent
            limit={GROUP_LIMIT}
            limitTip={t('group.maxLimitTip', { count: GROUP_LIMIT })}
            sortValues={group ?? undefined}
            addBtnText={t('group.addButton')}
            onChange={onChangeInner}
          />
        </>
      }
    >
      {children?.(text, isActive)}
    </AdaptivePanel>
  );
};
