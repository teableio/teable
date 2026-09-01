import type { ISort } from '@teable/core';
import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { AdaptivePanel, useIsDrawerPanel } from '../adaptive-panel';
import { ReadOnlyTip } from '../ReadOnlyTip';
import { SortConfig } from './SortConfig';
import { SortContent } from './SortContent';

interface ISortBaseProps {
  sorts: ISort | null;
  manualSortLoading?: boolean;
  onChange: (sort: ISort | null) => void;
  manualSortOnClick?: () => void;
  hiddenManual?: boolean;
  /** Render as a bottom drawer on narrow viewports. Toolbar call sites only. */
  responsive?: boolean;
  children: React.ReactNode;
}

export interface ISortBaseRef {
  close: () => void;
}

export const SortBase = forwardRef<ISortBaseRef, ISortBaseProps>((props, sortBaseRef) => {
  const {
    children,
    manualSortLoading,
    sorts,
    hiddenManual,
    responsive,
    manualSortOnClick,
    onChange,
  } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const isDrawer = useIsDrawerPanel(responsive);
  const { sortObjs, manualSort } = sorts || {};

  useImperativeHandle(sortBaseRef, () => ({
    close: () => setIsOpen(false),
  }));

  const onSortConfigChange = (value: boolean) => {
    if (sortObjs) {
      onChange({
        sortObjs,
        manualSort: value,
      });
      return;
    }
    onChange(null);
  };

  const onSortObjsChange = (sorts?: NonNullable<ISort>['sortObjs']) => {
    const sortObjs = sorts?.length
      ? {
          sortObjs: sorts,
          manualSort,
        }
      : null;
    onChange(sortObjs);
  };

  const hasSorts = Boolean(sortObjs?.length);

  return (
    <AdaptivePanel
      responsive={responsive}
      open={isOpen}
      onOpenChange={setIsOpen}
      title={t('sort.setTips')}
      popoverClassName="relative w-fit max-w-screen-md overflow-hidden rounded-lg p-0"
      // Empty state is a searchable field list: pin the height so filtering
      // does not resize the panel. Once rules exist the height follows them.
      drawerSize={hasSorts ? 'auto' : 'list'}
      bodyClassName={hasSorts ? undefined : 'overflow-hidden'}
      footerClassName="border-t-0 p-0"
      overlay={<ReadOnlyTip />}
      content={
        <>
          {/* The drawer promotes this line to its heading, so rendering it
              again in the body would just repeat the title. */}
          {!isDrawer && <div className="px-4 pt-3 text-[13px]">{t('sort.setTips')}</div>}
          <SortContent sortValues={sortObjs} onChange={onSortObjsChange} />
        </>
      }
      footer={
        hasSorts && !hiddenManual ? (
          <SortConfig
            buttonLoading={manualSortLoading}
            value={manualSort}
            onChange={onSortConfigChange}
            onClick={manualSortOnClick}
          />
        ) : undefined
      }
    >
      {children}
    </AdaptivePanel>
  );
});

SortBase.displayName = 'SortBase';
