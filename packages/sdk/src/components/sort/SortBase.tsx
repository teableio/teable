import type { ISort } from '@teable/core';
import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { SortConfig } from './SortConfig';
import { SortContent } from './SortContent';

interface ISortBaseProps {
  sorts: ISort | null;
  manualSortLoading?: boolean;
  onChange: (sort: ISort | null) => void;
  manualSortOnClick?: () => void;
  hiddenManual?: boolean;
  children: React.ReactNode;
}

export interface ISortBaseRef {
  close: () => void;
}

export const SortBase = forwardRef<ISortBaseRef, ISortBaseProps>((props, sortBaseRef) => {
  const { children, manualSortLoading, sorts, hiddenManual, manualSortOnClick, onChange } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent side="bottom" align="start" className="w-fit max-w-screen-md p-0">
        <header className="mx-3">
          <div className="border-b py-3 text-[13px]">{t('sort.setTips')}</div>
        </header>
        <SortContent sortValues={sortObjs} onChange={onSortObjsChange} />
        {Boolean(sortObjs?.length) && !hiddenManual && (
          <SortConfig
            buttonLoading={manualSortLoading}
            value={manualSort}
            onChange={onSortConfigChange}
            onClick={manualSortOnClick}
          />
        )}
      </PopoverContent>
    </Popover>
  );
});

SortBase.displayName = 'SortBase';
