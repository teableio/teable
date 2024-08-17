import { ChevronRight } from '@teable/icons';
import type { IImportOptionRo } from '@teable/openapi';
import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component/base/BaseSingleSelect';
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Switch,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';
import type { ITableImportOptions } from '../TableImport';
import type { IInplaceOption } from './inplace-panel/InplaceFieldConfigPanel';

interface ICollapsePanel {
  onChange: (value: boolean, propertyName: keyof ITableImportOptions) => void;
  options: ITableImportOptions;
}

interface IInplaceCollapsePanel {
  onChange: (value: IInplaceOption, propertyName: keyof IInplaceOption) => void;
  options: IInplaceOption;
  workSheets: IImportOptionRo['worksheets'];
}

const CollapseWraper = (props: { children: React.ReactElement }) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(['table']);
  const { children } = props;

  return (
    <Collapsible open={open} onOpenChange={(open) => setOpen(open)} className="w-full rounded-sm">
      <CollapsibleTrigger className="w-full" asChild>
        <Button variant="ghost" className="flex w-full justify-start">
          <ChevronRight className={cn('h-4 w-4 transition', open ? 'rotate-90' : 'rotate-0')} />
          {t('table:import.title.optionsTitle')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col items-start">{children}</CollapsibleContent>
    </Collapsible>
  );
};

export const ImportOptionPanel = (props: ICollapsePanel) => {
  const { options, onChange } = props;
  const { t } = useTranslation(['table']);

  return (
    <CollapseWraper>
      <div>
        <label
          htmlFor="autoSelectType"
          className="flex w-56 cursor-pointer items-center rounded p-2 text-sm hover:bg-accent"
        >
          <Switch
            id="autoSelectType"
            checked={options.autoSelectType}
            onCheckedChange={(value) => onChange(value, 'autoSelectType')}
          />
          <span className="pl-2">{t('table:import.options.autoSelectFieldOptionName')}</span>
        </label>

        <label
          htmlFor="useFirstRowAsHeader"
          className="flex w-56 cursor-pointer items-center rounded p-2 text-sm hover:bg-accent"
        >
          <Switch
            id="useFirstRowAsHeader"
            checked={options.useFirstRowAsHeader}
            onCheckedChange={(value) => onChange(value, 'useFirstRowAsHeader')}
          />
          <span className="pl-2">{t('table:import.options.useFirstRowAsHeaderOptionName')}</span>
        </label>

        <label
          htmlFor="importData"
          className="flex w-56 cursor-pointer items-center rounded p-2 text-sm hover:bg-accent"
        >
          <Switch
            id="importData"
            checked={options.importData}
            onCheckedChange={(value) => onChange(value, 'importData')}
          />
          <span className="pl-2">{t('table:import.options.importDataOptionName')}</span>
        </label>
      </div>
    </CollapseWraper>
  );
};

export const InplaceImportOptionPanel = (props: IInplaceCollapsePanel) => {
  const { options, workSheets, onChange } = props;
  const { t } = useTranslation(['table']);

  const sheetKeyOptions = Object.keys(workSheets).map((key) => ({
    label: key,
    value: key,
    icon: null,
  }));

  const onChangeHandler = (
    propertyName: keyof IInplaceOption,
    value: IInplaceOption[keyof IInplaceOption]
  ) => {
    const newOptions = { ...options, [propertyName]: value };
    onChange(newOptions, propertyName);
  };

  return (
    <CollapseWraper>
      <div>
        {sheetKeyOptions?.length > 1 ? (
          <div className="pl-4">
            <span className="text-xs">{t('table:import.options.sheetKey')}</span>
            <BaseSingleSelect
              value={options.sourceWorkSheetKey}
              options={sheetKeyOptions}
              onSelect={(value) => {
                onChangeHandler('sourceWorkSheetKey', value || '');
              }}
              className="m-1 w-56 truncate"
              popoverClassName="w-56"
            />
          </div>
        ) : null}

        <label
          htmlFor="excludeFirstRow"
          className="ml-4 flex w-56 cursor-pointer items-center rounded py-2 text-sm hover:bg-accent"
        >
          <Switch
            id="excludeFirstRow"
            checked={options.excludeFirstRow}
            onCheckedChange={(value) => onChangeHandler('excludeFirstRow', value)}
          />
          <span className="pl-2">{t('table:import.options.excludeFirstRow')}</span>
        </label>
      </div>
    </CollapseWraper>
  );
};
